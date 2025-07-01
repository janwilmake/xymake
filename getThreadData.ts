export interface ThreadData {
  "X-CACHE": string;
  tweets: Tweet[];
  userCounts: { [key: string]: number };
  participantsText: string;
  authorUser: User | null;
  topUser: User | null;
  totalTokens: number;
  title: string;
  postCount: number;
  description: string;
  avatarUrls: string[];
  ogImageUrl: string;
}

export interface Tweet {
  /** added property: this is the main tweet requested */
  is_main_tweet: boolean;
  /**added property: indicates its a quoted parent, not part of the original thread*/
  is_quoted_parent: boolean;

  id_str: string;
  full_text: string;
  tweet_created_at: string;
  source: string;
  truncated: boolean;
  in_reply_to_status_id_str: string | null;
  in_reply_to_user_id_str: string | null;
  in_reply_to_screen_name: string | null;
  user: User;
  lang: string;
  quoted_status_id_str: string | null;
  is_quote_status: boolean;
  is_pinned: boolean;
  quote_count: number;
  reply_count: number;
  retweet_count: number;
  favorite_count: number;
  views_count: number;
  bookmark_count: number;
  quoted_status?: Tweet | null;
  retweeted_status?: Tweet | null;
  entities: TweetEntities;
}

interface User {
  id_str: string;
  name: string;
  screen_name: string;
  location: string;
  description: string;
  url?: string | null;
  protected: boolean;
  verified: boolean;
  followers_count: number;
  friends_count: number;
  listed_count: number;
  favourites_count: number;
  statuses_count: number;
  created_at: string;
  profile_banner_url: string;
  profile_image_url_https: string;
  can_dm: boolean | null;
}

interface TweetEntities {
  urls: UrlEntity[];
  user_mentions: UserMentionEntity[];
  hashtags: HashtagEntity[];
  symbols: SymbolEntity[];
  media?: MediaEntity[];
  poll?: PollEntity;
}

interface UrlEntity {
  url: string;
  expanded_url: string;
  display_url: string;
  indices: number[];
}

interface UserMentionEntity {
  id_str: string;
  name: string;
  screen_name: string;
  indices: number[];
}

interface HashtagEntity {
  text: string;
  indices: number[];
}

interface SymbolEntity {
  text: string;
  indices: number[];
}

interface MediaEntity {
  id_str: string;
  media_url_https: string;
  url: string;
  display_url: string;
  expanded_url: string;

  video_info?: {
    aspect_ratio: [number, number];
    duration_millis: number;
    variants: {
      content_type: string;
      url: string;
    }[];
  };
  type: "photo" | "video" | "animated_gif";
  indices: number[];
}

interface PollEntity {
  end_datetime: string;
  duration_minutes: number;
  counts_are_final: boolean;
  choices: PollChoice[];
}

interface PollChoice {
  label: string;
  count: number;
}

interface TweetsResponse {
  next_cursor: string | null;
  tweets: Tweet[];
}

interface ErrorResponse {
  status: "error";
  message: string;
}

export interface Env {
  SOCIALDATA_API_KEY: string;
  TWEET_KV: KVNamespace;
}

interface CachedTweetData {
  timestamp: number;
  tweets: Tweet[];
  isIncomplete?: boolean;
  "X-CACHE": "HIT" | "MISS";
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

const BASE_URL = "https://api.socialdata.tools";

// Format tweet as Markdown
export function formatTweetAsMarkdown(tweet: Tweet): string {
  const date = new Date(tweet.tweet_created_at).toLocaleString();
  let tweetText = tweet.full_text;

  // Expand URLs in the tweet text
  if (tweet.entities.urls && tweet.entities.urls.length > 0) {
    for (const urlEntity of tweet.entities.urls) {
      tweetText = tweetText.replace(urlEntity.url, urlEntity.expanded_url);
    }
  }

  let markdown = `@${tweet.user.screen_name} - ${date}: ${tweetText}`;

  // Add media content
  if (tweet.entities.media && tweet.entities.media.length > 0) {
    const mediaItems = [
      ...new Set(
        tweet.entities.media.map((media) => {
          // For photos, just include the URL
          if (media.type === "photo") {
            return `\n[Image: ${media.media_url_https}]`;
          }
          // For videos and GIFs, include both the thumbnail and video URL if available
          else if (media.type === "video" || media.type === "animated_gif") {
            const videoUrl = media.video_info?.variants[0]?.url || "";
            if (videoUrl) {
              return `\n[Video: ${videoUrl}]`;
            } else {
              return `\n[Video: ${media.media_url_https}]`;
            }
          }
          return "";
        }),
      ),
    ];

    // Add media items to the markdown
    markdown += mediaItems.join("");

    // Also replace any media URLs in the text with empty strings to avoid duplication
    for (const media of tweet.entities.media) {
      tweetText = tweetText.replace(media.url, "");
    }
  }

  // Add engagement stats if present
  const stats = [];
  if (tweet.favorite_count > 0) stats.push(`${tweet.favorite_count} likes`);
  if (tweet.retweet_count > 0) stats.push(`${tweet.retweet_count} retweets`);
  if (stats.length > 0) {
    markdown += `\n(${stats.join(", ")})`;
  }

  return markdown;
}

const getAllTweets = async (env: Env, tweetId: string, format: string) => {
  // Check KV cache first
  const cacheKey = `v4.${tweetId}.${format}`;
  const cachedData = await env.TWEET_KV.get<CachedTweetData>(cacheKey, {
    type: "json",
  });

  const currentTime = Date.now();

  if (cachedData && cachedData.tweets.length > 0) {
    const latestTweetTime = Math.max(
      ...cachedData.tweets.map((t) => new Date(t.tweet_created_at).getTime()),
    );

    if (currentTime - latestTweetTime > ONE_DAY_MS) {
      return cachedData;
    }

    if (currentTime - cachedData.timestamp < 3600000) {
      return cachedData;
    }
  }

  // Fetch fresh data
  const [mainTweet] = await Promise.all([
    fetchTweet(tweetId, env.SOCIALDATA_API_KEY),
    //  fetchAllComments(tweetId, env.SOCIALDATA_API_KEY),
  ]);

  const parents = await fetchParentTweets(mainTweet, env.SOCIALDATA_API_KEY);
  const allTweets: Tweet[] = [
    { ...mainTweet, is_main_tweet: true },
    ...parents,
    // ...comments,
  ];

  allTweets.sort((a, b) => {
    const dateA = new Date(a.tweet_created_at).getTime();
    const dateB = new Date(b.tweet_created_at).getTime();
    if (dateA !== dateB) {
      return dateA - dateB; // Sort by timestamp first
    } else {
      const idA = BigInt(a.id_str);
      const idB = BigInt(b.id_str);
      return idA < idB ? -1 : idA > idB ? 1 : 0; // Use tweet ID if timestamps are equal
    }
  });

  // Store in KV with 30-day TTL
  const cacheData: CachedTweetData = {
    timestamp: currentTime,
    tweets: allTweets,
    "X-CACHE": "HIT",
  };

  await env.TWEET_KV.put(cacheKey, JSON.stringify(cacheData), {
    expirationTtl: THIRTY_DAYS_SECONDS,
  });

  return { ...cacheData, "X-CACHE": "MISS" as "MISS" };
};

// Fetch a single tweet by ID

async function fetchTweet(tweetId: string, apiKey: string): Promise<Tweet> {
  const response = await fetch(`${BASE_URL}/twitter/tweets/${tweetId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const error: ErrorResponse = await response.json();
    throw new Error(`Failed to fetch tweet ${tweetId}: ${error.message}`);
  }

  return response.json();
}

// Fetch all comments for a tweet
async function fetchAllComments(
  tweetId: string,
  apiKey: string,
  onePage?: boolean,
): Promise<Tweet[]> {
  let comments: Tweet[] = [];
  let cursor: string | null = null;

  do {
    const url = `${BASE_URL}/twitter/tweets/${tweetId}/comments${
      cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
    }`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(
        `Failed to fetch comments for tweet ${tweetId}: ${error.message}`,
      );
    }

    const data: TweetsResponse = await response.json();
    comments = comments.concat(data.tweets);
    cursor = data.next_cursor;
  } while (cursor && !onePage);

  return comments;
}

// Fetch parent tweets recursively
async function fetchParentTweets(
  tweet: Tweet,
  apiKey: string,
  seenIds: Set<string> = new Set(),
): Promise<Tweet[]> {
  const parents: Tweet[] = [];
  seenIds.add(tweet.id_str);

  if (tweet.quoted_status_id_str && !seenIds.has(tweet.quoted_status_id_str)) {
    const quotedTweet = await fetchTweet(tweet.quoted_status_id_str, apiKey);
    parents.push({ ...quotedTweet, is_quoted_parent: true });
    //recursively do this
    const nestedParents = await fetchParentTweets(quotedTweet, apiKey, seenIds);
    parents.push(
      ...nestedParents.map((x) => ({ ...x, is_quoted_parent: true })),
    );
  }

  if (
    tweet.in_reply_to_status_id_str &&
    !seenIds.has(tweet.in_reply_to_status_id_str)
  ) {
    const replyParent = await fetchTweet(
      tweet.in_reply_to_status_id_str,
      apiKey,
    );
    parents.push(replyParent);
    const nestedParents = await fetchParentTweets(replyParent, apiKey, seenIds);
    parents.push(...nestedParents);
  }

  return parents;
}

/** Calculates important metadata for both html and og-html */
export const getThreadData = async (
  request: Request,
  env: Env,
  ctx: any,
  isUserPublic: boolean,
): Promise<ThreadData | undefined> => {
  const url = new URL(request.url);
  const makeId = url.searchParams.get("make");
  const makeSuffix = makeId ? `?make=${makeId}` : "";
  const pathParts = url.pathname.split("/");

  if (pathParts.length < 4 || !["status", "og"].includes(pathParts[2])) {
    return;
  }

  // Split the last part to handle optional format
  const lastPart = pathParts[3];
  const [tweetId, formatExt] = lastPart.split(".");

  const storageFormat = formatExt === "json" ? "json" : "md";

  let allTweets: CachedTweetData;
  if (!isUserPublic) {
    const cacheKey = `free.${tweetId}`;

    const cachedData = await env.TWEET_KV.get<CachedTweetData>(cacheKey, {
      type: "json",
    });

    if (cachedData) {
      allTweets = cachedData;
    } else {
      const [tweet] = await Promise.all([
        fetchTweet(tweetId, env.SOCIALDATA_API_KEY),
        //  fetchAllComments(tweetId, env.SOCIALDATA_API_KEY, true),
      ]);

      const tweets = [
        { ...tweet, is_main_tweet: true },
        tweet.quoted_status,
        // ...comments,
      ]
        .filter(Boolean)
        .map((x) => x!);
      allTweets = {
        tweets,
        "X-CACHE": "HIT" as "HIT",
        timestamp: Date.now(),
        isIncomplete: true,
      };

      ctx.waitUntil(env.TWEET_KV.put(cacheKey, JSON.stringify(allTweets)));
    }
  } else {
    allTweets = await getAllTweets(env, tweetId, storageFormat);
  }

  const markdownContent = allTweets.tweets
    .map(formatTweetAsMarkdown)
    .join("\n\n");

  const TOKENS_PER_REPLY = 120;
  const totalTokens = allTweets.isIncomplete
    ? Math.round(
        markdownContent.length / 5 +
          allTweets.tweets[0].reply_count * TOKENS_PER_REPLY,
      )
    : Math.round(markdownContent.length / 5);

  // Count occurrences of each user
  const userOccurrences = new Map<string, number>();
  const userMap = new Map<string, User>();

  allTweets.tweets.forEach((tweet) => {
    const screenName = tweet.user.screen_name;
    userOccurrences.set(screenName, (userOccurrences.get(screenName) || 0) + 1);
    userMap.set(screenName, tweet.user);
  });

  const sortedUserCountEntries = Array.from(userOccurrences.entries()).sort(
    (a, b) => b[1] - a[1],
  );
  // Sort users by occurrence count (descending)
  const sortedUsers = sortedUserCountEntries.map(
    ([screenName]) => userMap.get(screenName)!,
  );

  //

  let authorUser = null;
  for (const tweet of allTweets.tweets) {
    if (!tweet.in_reply_to_status_id_str && !tweet.is_quoted_parent) {
      // the first one thats not a reply
      authorUser = tweet.user;
      break;
    }
  }

  // Determine main user (most posts are from this person)
  const topUser = sortedUsers[0];

  // Extract user screen names in order of frequency
  const userScreenNames = sortedUsers.map((user) => user.screen_name);

  // Create avatar URLs array in the same order as userScreenNames
  const avatarUrls = sortedUsers.map((user) => user.profile_image_url_https);

  // Generate participant text
  let participantsText = "";
  if (userScreenNames.length === 1) {
    participantsText = `@${userScreenNames[0]}`;
  } else if (userScreenNames.length <= 3) {
    // For 2-3 users, list all of them
    if (authorUser) {
      const otherUsers = userScreenNames.filter(
        (name) => name !== authorUser.screen_name,
      );
      participantsText = `@${authorUser.screen_name} and ${otherUsers
        .map((name) => `@${name}`)
        .join(", ")}`;
    } else {
      participantsText = userScreenNames.map((name) => `@${name}`).join(", ");
    }
  } else {
    // For more than 3 users, show main user and top 2 others, plus count of remaining
    const otherTopUsers = userScreenNames
      .filter((name) => name !== authorUser?.screen_name)
      .slice(0, 2);
    const remainingCount = userScreenNames.length - otherTopUsers.length - 1;
    participantsText = `@${authorUser?.screen_name}, ${otherTopUsers
      .map((name) => `@${name}`)
      .join(", ")} and ${
      allTweets.isIncomplete ? "many" : remainingCount
    } others`;
  }

  // Generate title and description for SEO
  const firstTweet = allTweets.tweets.length > 0 ? allTweets.tweets[0] : null;

  const description = firstTweet
    ? `${participantsText} on X: '${firstTweet.full_text
        .substring(0, 60)
        .replaceAll("\n", " ")
        .replaceAll('"', "'")}${firstTweet.full_text.length > 60 ? "..." : ""}'`
    : "";

  const postCount = allTweets.isIncomplete
    ? allTweets.tweets[0].reply_count + 1
    : allTweets.tweets.length;

  const title = `${participantsText} on X with ${postCount} posts (${totalTokens} tokens)`;
  const ogImageUrl = `${url.origin}/${pathParts[1]}/og/${tweetId}${makeSuffix}`;
  const threadData: ThreadData = {
    postCount,
    ogImageUrl,
    tweets: allTweets.tweets,
    userCounts: Object.fromEntries(sortedUserCountEntries),
    participantsText,
    authorUser,
    topUser,
    totalTokens,
    title,
    description,
    avatarUrls,
    "X-CACHE": allTweets["X-CACHE"],
  };
  return threadData;
};
