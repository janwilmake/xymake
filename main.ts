// X Login with Tweet Feed
// Uses OAuth for authentication and Durable Objects for tweet storage and rate-limited updates

interface Env {
  X_CLIENT_ID: string;
  X_CLIENT_SECRET: string;
  X_REDIRECT_URI: string;
  LOGIN_REDIRECT_URI: string;
  X_FEED: DurableObjectNamespace;
}

interface XUserState {
  access_token: string;
  is_private: boolean;
  last_alarm_time: number;
  secret?: string;
}

// Used for caching user profile data
interface XUserProfile {
  id: string;
  name: string;
  username: string;
  profile_image_url: string;
  updated_at: number;
}

// Used for Tweet data structure
interface Tweet {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  in_reply_to_id?: string;
  is_reply: boolean;
  is_retweet: boolean;
  is_like: boolean;
  is_bookmark: boolean;
  metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}

// HTML template helper
export const html = (strings: TemplateStringsArray, ...values: any[]) => {
  return strings.reduce(
    (result, str, i) => result + str + (values[i] || ""),
    "",
  );
};

// OAuth helpers
async function generateRandomString(length: number): Promise<string> {
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// XUserFeed Durable Object implementation
export class XFeed implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private userState: XUserState | null = null;
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    //  super(state, env);
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
  }

  // Initialize the database schema if needed
  async initializeSchema() {
    // Create the tweets table
    await this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tweets (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        author_id TEXT NOT NULL,
        in_reply_to_id TEXT,
        is_reply BOOLEAN DEFAULT 0,
        is_retweet BOOLEAN DEFAULT 0,
        is_like BOOLEAN DEFAULT 0,
        is_bookmark BOOLEAN DEFAULT 0,
        retweet_count INTEGER DEFAULT 0,
        reply_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        quote_count INTEGER DEFAULT 0,
        inserted_at INTEGER NOT NULL
      )
    `);

    // Create the user profile table
    await this.sql.exec(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT NOT NULL,
        profile_image_url TEXT,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  // Load user state from storage
  async loadUserState(): Promise<XUserState> {
    if (this.userState) return this.userState;

    const userState = (await this.state.storage.get("userState")) as XUserState;
    if (!userState) {
      // Create default user state
      this.userState = {
        access_token: "",
        is_private: false,
        last_alarm_time: 0,
        secret: await generateRandomString(16),
      };
      await this.state.storage.put("userState", this.userState);
    } else {
      this.userState = userState;
    }

    return this.userState;
  }

  // Handle fetch requests to the Durable Object
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Initialize database if needed
    await this.initializeSchema();

    // Load user state
    await this.loadUserState();

    console.log("userstate", this.userState);

    if (url.pathname.endsWith("/setup")) {
      // Handle setup endpoint
      if (request.method === "POST") {
        try {
          const data: { access_token: string } = await request.json();
          if (data.access_token) {
            this.userState!.access_token = data.access_token;
            await this.state.storage.put("userState", this.userState);
            return new Response(JSON.stringify({ success: true }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({ error: "Missing access_token" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        } catch (error) {
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Invalid JSON",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    } else if (url.pathname.endsWith("/update")) {
      return await this.handleUpdate();
    } else if (url.pathname.endsWith("/toggle-privacy")) {
      return await this.togglePrivacy();
    } else if (url.pathname.endsWith("/profile")) {
      return await this.getProfile();
    } else {
      // Default: return tweets
      return await this.getTweets(url.searchParams.get("secret") || "");
    }
  }

  // Handle scheduled alarms
  async alarm(): Promise<void> {
    console.log("Alarm triggered, updating tweets");
    await this.updateTweets();
  }

  // Update tweets from X API
  async updateTweets(): Promise<{ newTweetsCount: number }> {
    await this.loadUserState();
    if (!this.userState?.access_token) {
      throw new Error("No access token available");
    }

    // Update user profile if needed (once per day)
    const userProfile = await this.getUserProfile();
    const now = Date.now();
    if (!userProfile || userProfile.updated_at < now - 24 * 60 * 60 * 1000) {
      await this.updateUserProfile();
    }

    // Fetch recent tweets
    const tweets = await this.fetchRecentTweets();

    // Count new tweets
    let newTweetsCount = 0;

    // Check if we got any tweets back
    if (tweets.items && tweets.items.length > 0) {
      this.state.storage.delete("error");

      // Insert tweets and count new ones
      newTweetsCount = await this.insertTweets(tweets.items, "tweet");

      // Find reply tweets we need to fetch
      const replyIds = await this.findMissingReplyTweets(tweets.items);
      if (replyIds.length > 0) {
        const replyTweets = await this.fetchTweetsByIds(replyIds);
        if (replyTweets && replyTweets.length > 0) {
          await this.insertTweets(replyTweets, "reply");
        }
      }

      // Fetch and insert retweets
      // const retweets = await this.fetchRetweets();
      // if (retweets && retweets.length > 0) {
      //   await this.insertTweets(retweets, "retweet");
      // }

      // // Fetch and insert liked tweets
      // const likes = await this.fetchLikes();
      // if (likes && likes.length > 0) {
      //   await this.insertTweets(likes, "like");
      // }

      // // Fetch and insert bookmarked tweets
      // const bookmarks = await this.fetchBookmarks();
      // if (bookmarks && bookmarks.length > 0) {
      //   await this.insertTweets(bookmarks, "bookmark");
      // }
    } else if (tweets.error) {
      this.state.storage.put("error", tweets.error);
    }

    // Schedule next update based on whether we found new tweets
    await this.scheduleNextUpdate(newTweetsCount > 0);

    return { newTweetsCount };
  }

  // Schedule the next update alarm
  async scheduleNextUpdate(foundNewTweets: boolean): Promise<void> {
    await this.loadUserState();
    const now = Date.now();
    let nextAlarmTime: number;

    if (foundNewTweets) {
      // If we found new tweets, check again in 15 minutes
      nextAlarmTime = now + 15 * 60 * 1000;
    } else {
      // If no new tweets, double the wait time with a maximum of 24 hours
      const lastInterval = now - (this.userState?.last_alarm_time || now);
      const nextInterval = Math.min(lastInterval * 2, 24 * 60 * 60 * 1000);
      nextAlarmTime = now + nextInterval;
    }

    // Update last alarm time
    this.userState!.last_alarm_time = now;
    await this.state.storage.put("userState", this.userState);

    // Set the alarm
    await this.state.storage.setAlarm(nextAlarmTime);
  }

  // Fetch user profile from X API
  async getUserProfile(): Promise<XUserProfile | null> {
    try {
      const result = this.sql
        .exec("SELECT * FROM user_profile LIMIT 1")
        .one() as unknown as XUserProfile;
      return result || null;
    } catch (error) {
      console.error("Error getting user profile", error);
      return null;
    }
  }

  // Update user profile from X API
  async updateUserProfile(): Promise<XUserProfile | null> {
    await this.loadUserState();
    if (!this.userState?.access_token) {
      throw new Error("No access token available");
    }

    try {
      const response = await fetch(
        "https://api.x.com/2/users/me?user.fields=profile_image_url",
        {
          headers: {
            Authorization: `Bearer ${this.userState.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `X API error: ${response.status} ${await response.text()}`,
        );
      }

      const userData: any = await response.json();
      const { id, name, username, profile_image_url } = userData.data;
      const now = Date.now();

      // Update the user profile in SQLite
      await this.sql.exec(
        `INSERT OR REPLACE INTO user_profile (id, name, username, profile_image_url, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        name,
        username,
        profile_image_url,
        now,
      );

      return {
        id,
        name,
        username,
        profile_image_url,
        updated_at: now,
      };
    } catch (error) {
      console.error("Error updating user profile", error);
      return null;
    }
  }

  // Fetch recent tweets from X API
  async fetchRecentTweets(): Promise<{ error?: string; items?: any[] }> {
    await this.loadUserState();
    if (!this.userState?.access_token) {
      throw new Error("No access token available");
    }

    try {
      const userProfile = await this.getUserProfile();
      if (!userProfile) {
        throw new Error("User profile not found");
      }

      const params = new URLSearchParams({
        "tweet.fields":
          "created_at,public_metrics,referenced_tweets,in_reply_to_user_id",
        "user.fields": "username,name,profile_image_url",
        expansions:
          "author_id,referenced_tweets.id,referenced_tweets.id.author_id,in_reply_to_user_id",
        max_results: "100",
      });

      const response = await fetch(
        `https://api.x.com/2/users/${
          userProfile.id
        }/tweets?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${this.userState.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );

      console.log("check", userProfile.username);

      if (response.status === 429) {
        const resetDate = response.headers.get("x-rate-limit-reset");

        const resetInHours = resetDate
          ? Math.round((Number(resetDate) * 1000 - Date.now()) / 36000) / 100
          : undefined;
        throw new Error(
          `RATE LIMIT ERROR ${userProfile.username}:  reset in ${resetInHours} hours`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `X API error: ${response.status} ${
            userProfile.username
          } ${await response.text()}`,
        );
      }

      const data: any = await response.json();
      console.log("SUCCESS", Object.keys(data));

      return { items: data.data || [] };
    } catch (error: any) {
      return { error: "Error fetching recent tweets" + error.message };
    }
  }

  // Find missing reply tweets that need to be fetched
  async findMissingReplyTweets(tweets: any[]): Promise<string[]> {
    try {
      // Extract reply-to IDs from tweets
      const replyIds = tweets
        .filter((tweet) =>
          tweet.referenced_tweets?.some(
            (ref: { type: string }) => ref.type === "replied_to",
          ),
        )
        .map((tweet) => {
          const replyRef = tweet.referenced_tweets.find(
            (ref: { type: string }) => ref.type === "replied_to",
          );
          return replyRef ? replyRef.id : null;
        })
        .filter((id) => id !== null);

      if (replyIds.length === 0) return [];

      // Check which of these IDs are not in our database yet
      const placeholders = replyIds.map(() => "?").join(",");
      const existingIds = this.sql
        .exec(`SELECT id FROM tweets WHERE id IN (${placeholders})`, replyIds)
        .toArray()
        .map((row) => row.id);

      // Return only the IDs we don't have yet
      return replyIds.filter((id) => !existingIds.includes(id));
    } catch (error) {
      console.error("Error finding missing reply tweets", error);
      return [];
    }
  }

  // Fetch tweets by IDs from X API
  async fetchTweetsByIds(ids: string[]): Promise<any[]> {
    await this.loadUserState();
    if (!this.userState?.access_token) {
      throw new Error("No access token available");
    }

    try {
      if (ids.length === 0) return [];

      const params = new URLSearchParams({
        ids: ids.join(","),
        "tweet.fields":
          "created_at,public_metrics,referenced_tweets,in_reply_to_user_id",
        "user.fields": "username,name,profile_image_url",
        expansions:
          "author_id,referenced_tweets.id,referenced_tweets.id.author_id",
      });

      const response = await fetch(
        `https://api.x.com/2/tweets?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${this.userState.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `X API error: ${response.status} ${await response.text()}`,
        );
      }

      const data: any = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("Error fetching tweets by IDs", error);
      return [];
    }
  }

  // Fetch retweets from X API
  async fetchRetweets(): Promise<any[]> {
    await this.loadUserState();
    if (!this.userState?.access_token) {
      throw new Error("No access token available");
    }

    try {
      const userProfile = await this.getUserProfile();
      if (!userProfile) {
        throw new Error("User profile not found");
      }

      const params = new URLSearchParams({
        "tweet.fields": "created_at,public_metrics,referenced_tweets",
        "user.fields": "username,name,profile_image_url",
        expansions: "author_id,referenced_tweets.id",
        max_results: "100",
      });

      const response = await fetch(
        `https://api.x.com/2/users/${
          userProfile.id
        }/retweets?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${this.userState.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `X API error: ${response.status} ${await response.text()}`,
        );
      }

      const data: any = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("Error fetching retweets", error);
      return [];
    }
  }

  // Fetch liked tweets from X API
  async fetchLikes(): Promise<any[]> {
    await this.loadUserState();
    if (!this.userState?.access_token) {
      throw new Error("No access token available");
    }

    try {
      const userProfile = await this.getUserProfile();
      if (!userProfile) {
        throw new Error("User profile not found");
      }

      const params = new URLSearchParams({
        "tweet.fields": "created_at,public_metrics,referenced_tweets",
        "user.fields": "username,name,profile_image_url",
        expansions: "author_id",
        max_results: "100",
      });

      const response = await fetch(
        `https://api.x.com/2/users/${
          userProfile.id
        }/likes?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${this.userState.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `X API error: ${response.status} ${await response.text()}`,
        );
      }

      const data: any = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("Error fetching likes", error);
      return [];
    }
  }

  // Fetch bookmarked tweets from X API
  async fetchBookmarks(): Promise<any[]> {
    await this.loadUserState();
    if (!this.userState?.access_token) {
      throw new Error("No access token available");
    }

    try {
      const userProfile = await this.getUserProfile();
      if (!userProfile) {
        throw new Error("User profile not found");
      }

      const params = new URLSearchParams({
        "tweet.fields": "created_at,public_metrics,referenced_tweets",
        "user.fields": "username,name,profile_image_url",
        expansions: "author_id",
        max_results: "100",
      });

      const response = await fetch(
        `https://api.x.com/2/users/${
          userProfile.id
        }/bookmarks?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${this.userState.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `X API error: ${response.status} ${await response.text()}`,
        );
      }

      const data: any = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("Error fetching bookmarks", error);
      return [];
    }
  }

  // Insert tweets into SQLite database
  async insertTweets(
    tweets: any[],
    type: "tweet" | "reply" | "retweet" | "like" | "bookmark",
  ): Promise<number> {
    try {
      if (!tweets || tweets.length === 0) return 0;

      let newCount = 0;
      const now = Date.now();

      // Insert each tweet
      for (const tweet of tweets) {
        // Check if tweet already exists
        const existing = this.sql
          .exec("SELECT id FROM tweets WHERE id = ?", tweet.id)
          .one();
        if (existing) continue;

        // Determine if this is a reply
        const isReply =
          tweet.referenced_tweets?.some(
            (ref: { type: string }) => ref.type === "replied_to",
          ) || false;

        // Get the reply-to ID if this is a reply
        let replyToId = null;
        if (isReply) {
          const replyRef = tweet.referenced_tweets.find(
            (ref: { type: string }) => ref.type === "replied_to",
          );
          replyToId = replyRef ? replyRef.id : null;
        }

        // Set flags based on type
        const isRetweet = type === "retweet";
        const isLike = type === "like";
        const isBookmark = type === "bookmark";

        // Get metrics if available
        const metrics = tweet.public_metrics || {};

        // Insert the tweet
        await this.sql.exec(
          `INSERT INTO tweets (
            id, text, created_at, author_id, in_reply_to_id, 
            is_reply, is_retweet, is_like, is_bookmark,
            retweet_count, reply_count, like_count, quote_count, inserted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          tweet.id,
          tweet.text,
          tweet.created_at,
          tweet.author_id,
          replyToId,
          isReply ? 1 : 0,
          isRetweet ? 1 : 0,
          isLike ? 1 : 0,
          isBookmark ? 1 : 0,
          metrics.retweet_count || 0,
          metrics.reply_count || 0,
          metrics.like_count || 0,
          metrics.quote_count || 0,
          now,
        );

        newCount++;
      }

      return newCount;
    } catch (error) {
      console.error("Error inserting tweets", error);
      return 0;
    }
  }

  // Handle the /update endpoint
  async handleUpdate(): Promise<Response> {
    try {
      const result = await this.updateTweets();
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // Toggle privacy setting
  async togglePrivacy(): Promise<Response> {
    await this.loadUserState();
    this.userState!.is_private = !this.userState!.is_private;
    await this.state.storage.put("userState", this.userState);

    return new Response(
      JSON.stringify({ is_private: this.userState!.is_private }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Get user profile
  async getProfile(): Promise<Response> {
    await this.loadUserState();
    const profile = await this.getUserProfile();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ...profile,
        is_private: this.userState!.is_private,
        secret: this.userState!.is_private ? this.userState!.secret : undefined,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Get tweets with optional reply threading
  async getTweets(secret: string): Promise<Response> {
    await this.loadUserState();

    // Check privacy settings
    if (this.userState!.is_private && secret !== this.userState!.secret) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or missing secret" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      // Get user profile
      const profile = await this.getUserProfile();
      if (!profile) {
        throw new Error("User profile not found");
      }

      // Get all tweets, ordered by creation date (newest first)
      const tweets = this.sql
        .exec(`SELECT * FROM tweets ORDER BY created_at DESC`)
        .toArray();

      // Build a map for quick tweet lookups
      const tweetMap = new Map();
      tweets.forEach((tweet) => {
        tweetMap.set(tweet.id, tweet);
      });

      // Build thread chains for replies
      const threaded = tweets.map((tweet) => {
        // If this is a reply, try to find the parent tweet
        if (tweet.in_reply_to_id && tweetMap.has(tweet.in_reply_to_id)) {
          const parentTweet = tweetMap.get(tweet.in_reply_to_id);
          // Add parent tweet info
          return {
            ...tweet,
            replied_to: parentTweet,
          };
        }
        return tweet;
      });

      // // Determine response format from Accept header or URL extension
      // const format = pathname.endsWith(".json")
      //   ? "json"
      //   : pathname.endsWith(".html")
      //   ? "html"
      //   : "md";
      const error: string | null | undefined = await this.state.storage.get(
        "error",
      );
      const result = {
        profile,
        tweets: threaded,
        error,
      };

      return new Response(JSON.stringify(result, undefined, 2), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // Render tweets as Markdown
  renderTweetsMarkdown(profile: XUserProfile, tweets: any[]): string {
    let md = `# ${profile.name}'s X Feed (@${profile.username})\n\n`;

    tweets.forEach((tweet) => {
      md += this.renderTweetMarkdown(tweet, 0);
      md += "\n---\n\n";
    });

    return md;
  }

  // Render a single tweet as Markdown
  renderTweetMarkdown(tweet: any, depth: number): string {
    const date = new Date(tweet.created_at).toLocaleString();
    let prefix = "  ".repeat(depth);

    let md = `${prefix}${tweet.text}\n\n`;
    md += `${prefix}*${date}*`;

    if (tweet.is_reply) md += " • Reply";
    if (tweet.is_retweet) md += " • Retweet";
    if (tweet.is_like) md += " • Liked";
    if (tweet.is_bookmark) md += " • Bookmarked";

    md += "\n\n";

    // Add reply chain if available
    if (tweet.replied_to) {
      md += `${prefix}> In reply to:\n\n`;
      md += this.renderTweetMarkdown(tweet.replied_to, depth + 1);
    }

    return md;
  }
}

// Main Worker
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const cookie = request.headers.get("Cookie") || "";
    const rows = cookie.split(";").map((x) => x.trim());

    // Get X access token from cookies
    const xAccessToken = rows
      .find((row) => row.startsWith("x_access_token="))
      ?.split("=")[1]
      ?.trim();

    const accessToken = xAccessToken
      ? decodeURIComponent(xAccessToken)
      : url.searchParams.get("apiKey");

    // Check for username in path (for feed viewing)
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (
      pathParts.length === 1 &&
      pathParts[0] !== "login" &&
      pathParts[0] !== "callback" &&
      pathParts[0] !== "logout"
    ) {
      const username = pathParts[0].split(".")[0]; // Remove extension if present

      // Get Durable Object for this username
      const id = env.X_FEED.idFromName(username);
      const stub = env.X_FEED.get(id);

      // Forward the request to the Durable Object
      return stub.fetch(request);
    }

    // Login page route
    if (url.pathname === "/login") {
      const scope = url.searchParams.get("scope");
      const state = await generateRandomString(16);
      const codeVerifier = await generateRandomString(43);
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      const headers = new Headers({
        Location: `https://x.com/i/oauth2/authorize?response_type=code&client_id=${
          env.X_CLIENT_ID
        }&redirect_uri=${encodeURIComponent(
          env.X_REDIRECT_URI,
        )}&scope=${encodeURIComponent(
          scope || "users.read follows.read tweet.read offline.access",
        )}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
      });

      headers.append(
        "Set-Cookie",
        `x_oauth_state=${state}; HttpOnly; Path=/; Secure; SameSite=Lax; Max-Age=600`,
      );
      headers.append(
        "Set-Cookie",
        `x_code_verifier=${codeVerifier}; HttpOnly; Path=/; Secure; SameSite=Lax; Max-Age=600`,
      );

      return new Response("Redirecting", { status: 307, headers });
    }

    // X OAuth callback route
    if (url.pathname === "/callback") {
      const urlState = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      const stateCookie = rows
        .find((c) => c.startsWith("x_oauth_state="))
        ?.split("=")[1];
      const codeVerifier = rows
        .find((c) => c.startsWith("x_code_verifier="))
        ?.split("=")[1];

      // Validate state and code verifier
      if (
        !urlState ||
        !stateCookie ||
        urlState !== stateCookie ||
        !codeVerifier
      ) {
        return new Response(`Invalid state or missing code verifier`, {
          status: 400,
        });
      }

      try {
        // Exchange code for access token
        const tokenResponse = await fetch(
          "https://api.twitter.com/2/oauth2/token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${btoa(
                `${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`,
              )}`,
            },
            body: new URLSearchParams({
              code: code || "",
              redirect_uri: env.X_REDIRECT_URI,
              grant_type: "authorization_code",
              code_verifier: codeVerifier,
            }),
          },
        );

        if (!tokenResponse.ok) {
          throw new Error(`X API responded with ${tokenResponse.status}`);
        }

        const { access_token }: any = await tokenResponse.json();

        // Get user info to determine username
        const userResponse = await fetch(
          "https://api.x.com/2/users/me?user.fields=username",
          {
            headers: {
              Authorization: `Bearer ${access_token}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (!userResponse.ok) {
          throw new Error(`X API error: ${userResponse.status}`);
        }

        const userData: any = await userResponse.json();
        const { username } = userData.data;

        // Get Durable Object for this username and initialize it
        const id = env.X_FEED.idFromName(username);
        const stub = env.X_FEED.get(id);

        // Store access token in DO
        const response = await stub.fetch(
          new Request("https://dummy/setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ access_token }),
          }),
        );
        console.log("SETUP", await response.text());

        // Trigger initial data fetch
        ctx.waitUntil(stub.fetch(new Request("https://dummy/update")));

        const headers = new Headers({
          Location: `/${username}`,
        });

        // Set access token cookie and clear temporary cookies
        headers.append(
          "Set-Cookie",
          `x_access_token=${encodeURIComponent(
            access_token,
          )}; HttpOnly; Path=/; Secure; SameSite=Lax; Max-Age=34560000`,
        );
        headers.append("Set-Cookie", `x_oauth_state=; Max-Age=0; Path=/`);
        headers.append("Set-Cookie", `x_code_verifier=; Max-Age=0; Path=/`);

        return new Response("Redirecting", { status: 307, headers });
      } catch (error) {
        return new Response(
          html`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Login Failed</title>
              </head>
              <body>
                <h1>X Login Failed</h1>
                <p>
                  ${error instanceof Error ? error.message : "Unknown error"}
                </p>
                <a href="/">Home</a>
              </body>
            </html>
          `,
          {
            status: 500,
            headers: {
              "Content-Type": "text/html",
              "Set-Cookie": `x_oauth_state=; Max-Age=0; Path=/, x_code_verifier=; Max-Age=0; Path=/`,
            },
          },
        );
      }
    }

    // Logout route
    if (url.pathname === "/logout") {
      const headers = new Headers({
        Location: "/",
      });
      headers.append("Set-Cookie", `x_access_token=; Max-Age=0; Path=/`);
      return new Response("Logging out...", { status: 307, headers });
    }

    // Home page route (default)
    return new Response(
      html`
        <!DOCTYPE html>
        <html>
          <head>
            <title>X Feed</title>
            <meta
              name="viewport"
              content="width=device-width, initial-scale=1"
            />
            <style>
              body {
                font-family: sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                line-height: 1.6;
              }
              .btn {
                display: inline-block;
                padding: 10px 20px;
                background: #1da1f2;
                color: #fff;
                text-decoration: none;
                border-radius: 5px;
                margin: 10px 0;
              }
            </style>
          </head>
          <body>
            <h1>X Feed</h1>
            <p>
              Login with your X account to create a live feed of your posts.
            </p>
            <a href="/login" class="btn">Login with X</a>

            ${accessToken
              ? `
            <h2>Your X Feed</h2>
            <p>You're logged in! Access your feed:</p>
            <ul>
              <li><a href="${url.origin}/${
                  url.searchParams.get("username") || "your-username"
                }">View your feed</a></li>
            </ul>
            <a href="/logout" class="btn">Logout</a>
            `
              : ""}
          </body>
        </html>
      `,
      { headers: { "content-type": "text/html" } },
    );
  },
};
