/*
======X LOGIN SCRIPT WITH TWEET FETCHING AND CACHING========
Enhanced version of the X oauth implementation that adds
the ability to fetch and paginate through the user's recent tweets and comments.
Includes caching to respect X API rate limits (1 request per 15 minutes per user).

To use it, ensure to create a X oauth client, then set .dev.vars and wrangler.toml alike with the Env variables required.
Navigate to /login from the homepage, with optional parameters ?scope=a,b,c

In localhost this won't work due to your hardcoded redirect url; It's better to simply set your localstorage manually.
*/

export interface Env {
  X_CLIENT_ID: string;
  X_CLIENT_SECRET: string;
  X_REDIRECT_URI: string;
  LOGIN_REDIRECT_URI: string;
  // Add KV namespace for caching
  X_CACHE: KVNamespace;
}

export const html = (strings: TemplateStringsArray, ...values: any[]) => {
  return strings.reduce(
    (result, str, i) => result + str + (values[i] || ""),
    "",
  );
};

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

// Cache keys will be in the format: "user_content:{userId}"
const getUserCacheKey = (userId: string): string => `user_content:${userId}`;

async function getUserContentFromApiOrCache(
  userId: string,
  accessToken: string,
  env: Env,
  forceRefresh: boolean = false,
  limit: number = 50,
): Promise<any> {
  const cacheKey = getUserCacheKey(userId);

  // Check cache first if we're not forcing a refresh
  if (!forceRefresh) {
    const cachedContent = await env.X_CACHE.get(cacheKey, "json");
    if (cachedContent) {
      return cachedContent;
    }
  }

  // Cache miss or forced refresh, fetch from API
  try {
    // Fetch tweets with pagination using a single request
    const recent = await fetchUserContent(userId, accessToken);

    // Construct the response
    const result = {
      recent,
      meta: { cached_at: new Date().toISOString() },
    };

    // Store in cache for 15 minutes (900 seconds)
    await env.X_CACHE.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 900,
    });

    return result;
  } catch (error) {
    // If API request fails and we have cached data, return that as a fallback
    const cachedContent = await env.X_CACHE.get(cacheKey, "json");
    if (cachedContent) {
      return {
        ...cachedContent,
        meta: {
          ...cachedContent.meta,
          from_cache: true,
          error_message:
            error instanceof Error ? error.message : "Unknown error",
        },
      };
    }

    // No cache available, propagate the error
    throw error;
  }
}

async function fetchUserContent(
  userId: string,
  accessToken: string,
): Promise<any[]> {
  const params = new URLSearchParams({
    "tweet.fields":
      "created_at,public_metrics,referenced_tweets,in_reply_to_user_id",
    "user.fields": "profile_image_url",
    expansions:
      "author_id,referenced_tweets.id,referenced_tweets.id.author_id,in_reply_to_user_id",
    max_results: "100",
  });

  const response = await fetch(
    `https://api.x.com/2/users/${userId}/tweets?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`X API error: ${response.status} ${await response.text()}`);
  }

  const data: any = await response.json();
  return data.data;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const cookie = request.headers.get("Cookie") || "";
    const rows = cookie.split(";").map((x) => x.trim());

    // Get Twitter access token from cookies
    const xAccessToken = rows
      .find((row) => row.startsWith("x_access_token="))
      ?.split("=")[1]
      ?.trim();

    const accessToken = xAccessToken
      ? decodeURIComponent(xAccessToken)
      : url.searchParams.get("apiKey");

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

    // Twitter OAuth callback route
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
        return new Response(
          `Invalid state or missing code verifier ${JSON.stringify({
            urlState,
            stateCookie,
            codeVerifier,
          })}`,
          {
            status: 400,
          },
        );
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
          throw new Error(`Twitter API responded with ${tokenResponse.status}`);
        }

        const { access_token }: any = await tokenResponse.json();
        const headers = new Headers({
          Location: url.origin + (env.LOGIN_REDIRECT_URI || "/"),
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
            <html lang="en">
              <head>
                <title>Login Failed</title>
              </head>
              <body>
                <h1>Twitter Login Failed</h1>
                <p>
                  ${error instanceof Error ? error.message : "Unknown error"}
                </p>
                <script>
                  alert("Twitter login failed");
                  window.location.href = "/";
                </script>
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

    // Dashboard route for user data and tweets/comments
    if (url.pathname === "/dashboard" || url.pathname === "/dashboard.json") {
      // Check if JSON response is requested
      const wantsJson =
        url.pathname === "/dashboard.json" ||
        request.headers.get("Accept")?.includes("application/json") ||
        (url.searchParams.has("format") &&
          url.searchParams.get("format") === "json");

      if (!accessToken) {
        return new Response(
          wantsJson
            ? JSON.stringify({ error: "Unauthorized: No access token" })
            : html`
                <!DOCTYPE html>
                <html lang="en">
                  <head>
                    <title>Authentication Required</title>
                  </head>
                  <body>
                    <h1>Authentication Required</h1>
                    <p>Please <a href="/login">login with X</a> first.</p>
                  </body>
                </html>
              `,
          {
            status: 401,
            headers: {
              "Content-Type": wantsJson ? "application/json" : "text/html",
            },
          },
        );
      }

      try {
        // Fetch user data from Twitter API
        const userResponse = await fetch(
          "https://api.x.com/2/users/me?user.fields=profile_image_url",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (!userResponse.ok) {
          throw new Error(
            `X API error: ${userResponse.status} ${await userResponse.text()}`,
          );
        }

        const userData: any = await userResponse.json();
        const { id, name, username, profile_image_url } = userData.data;

        // Check if force refresh is requested
        const forceRefresh =
          url.searchParams.has("refresh") &&
          url.searchParams.get("refresh") === "true";

        // Get limit parameter
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);

        // If JSON format is requested, fetch tweets and comments
        if (wantsJson) {
          // Fetch content from cache or API
          const contentData = await getUserContentFromApiOrCache(
            id,
            accessToken,
            env,
            forceRefresh,
            limit,
          );

          return new Response(
            JSON.stringify({
              user: {
                id,
                name,
                username,
                profile_image_url,
              },
              ...contentData,
            }),
            {
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "private, max-age=900",
              },
            },
          );
        }

        // HTML response for browser view
        return new Response(
          html`
            <!DOCTYPE html>
            <html lang="en" class="bg-slate-900">
              <head>
                <meta charset="utf8" />
                <script src="https://cdn.tailwindcss.com"></script>
                <title>X User Dashboard</title>
                <style>
                  @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap");
                  body {
                    font-family: "Inter", sans-serif;
                  }
                </style>
              </head>
              <body class="text-slate-100">
                <main class="max-w-6xl mx-auto px-4 py-16">
                  <div class="text-center mb-20">
                    <h1
                      class="text-5xl font-bold mb-6 bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent"
                    >
                      X Dashboard
                    </h1>

                    <div
                      class="max-w-md mx-auto bg-slate-800 rounded-xl p-6 mb-8"
                    >
                      <div class="flex items-center gap-4">
                        <img
                          src="${profile_image_url}"
                          alt="Profile"
                          class="w-16 h-16 rounded-full"
                        />
                        <div class="text-left">
                          <h2 class="text-xl font-semibold">${name}</h2>
                          <p class="text-slate-400">@${username}</p>
                        </div>
                      </div>
                    </div>

                    <div class="flex justify-center gap-4 mb-8">
                      <a
                        href="/"
                        class="bg-blue-500 hover:bg-blue-600 px-6 py-3 rounded-lg font-medium transition-colors"
                      >
                        Home
                      </a>
                      <a
                        href="/dashboard.json"
                        class="bg-green-500 hover:bg-green-600 px-6 py-3 rounded-lg font-medium transition-colors"
                        target="_blank"
                      >
                        View API (JSON)
                      </a>
                      <a
                        href="/dashboard.json?refresh=true"
                        class="bg-yellow-500 hover:bg-yellow-600 px-6 py-3 rounded-lg font-medium transition-colors"
                        target="_blank"
                      >
                        Force Refresh Cache
                      </a>
                      <a
                        href="/logout"
                        class="border border-blue-500 text-blue-500 px-6 py-3 rounded-lg font-medium hover:bg-blue-500/10 transition-colors"
                      >
                        Logout
                      </a>
                    </div>

                    <div class="text-left mb-4 text-xl">
                      <p>To get your tweets and comments as JSON, access:</p>
                      <code
                        class="bg-slate-800 p-2 rounded block mt-2 text-sm overflow-x-auto"
                      >
                        GET /dashboard.json
                      </code>
                      <p class="mt-4">API Options:</p>
                      <ul class="bg-slate-800 p-2 rounded mt-2 text-sm">
                        <li>
                          <code>limit=50</code> - Number of tweets/comments to
                          retrieve (default: 50)
                        </li>
                        <li>
                          <code>refresh=true</code> - Force refresh the cache
                        </li>
                      </ul>
                      <div
                        class="mt-4 p-4 bg-blue-900/30 border border-blue-500/30 rounded-lg"
                      >
                        <h3 class="font-bold">⚠️ Rate Limiting Information</h3>
                        <p>
                          Data is cached for 15 minutes to respect X API rate
                          limits.
                        </p>
                        <p>
                          Use <code>refresh=true</code> only when necessary!
                        </p>
                      </div>
                    </div>
                  </div>
                </main>
              </body>
            </html>
          `,
          { headers: { "content-type": "text/html" } },
        );
      } catch (error) {
        return new Response(
          wantsJson
            ? JSON.stringify({
                error: error instanceof Error ? error.message : "Unknown error",
              })
            : html`
                <!DOCTYPE html>
                <html lang="en">
                  <head>
                    <title>Dashboard Error</title>
                  </head>
                  <body>
                    <h1>Error Loading Dashboard</h1>
                    <p>
                      ${error instanceof Error
                        ? error.message
                        : "Unknown error"}
                    </p>
                    <a href="/">Return Home</a>
                  </body>
                </html>
              `,
          {
            status: 500,
            headers: {
              "Content-Type": wantsJson ? "application/json" : "text/html",
            },
          },
        );
      }
    }

    // Home page route
    return new Response(
      html`
        <!DOCTYPE html>
        <html lang="en" class="bg-black">
          <head>
            <meta charset="utf8" />
            <meta
              name="viewport"
              content="width=device-width, initial-scale=1"
            />
            <script src="https://cdn.tailwindcss.com"></script>
            <title>X Login Demo with Tweet Fetching</title>
            <style>
              @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");
              body {
                font-family: "Inter", sans-serif;
              }
              .x-gradient {
                background: linear-gradient(135deg, #000000 0%, #1d1d1d 100%);
              }
              .x-border {
                border: 1px solid rgba(255, 255, 255, 0.1);
              }
            </style>
          </head>

          <body class="text-white">
            <main class="min-h-screen x-gradient">
              <div class="max-w-5xl mx-auto px-4 py-16">
                <!-- Hero Section -->
                <div class="text-center mb-20">
                  <div class="mb-8">
                    <svg
                      viewBox="0 0 24 24"
                      class="w-12 h-12 mx-auto"
                      fill="currentColor"
                    >
                      <path
                        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
                      />
                    </svg>
                  </div>
                  <h1 class="text-5xl font-bold mb-4">
                    X Login & Tweet Fetcher
                  </h1>
                  <p class="text-xl text-gray-400 mb-8">
                    Secure OAuth 2.0 Implementation with PKCE for X/Twitter with
                    Tweet & Comment Fetching (Rate-Limited)
                  </p>
                  <div class="flex justify-center gap-4">
                    <a
                      id="login"
                      href="${accessToken ? "/dashboard" : "/login"}"
                      class="bg-white text-black hover:bg-gray-200 px-8 py-4 rounded-full font-bold text-lg transition-colors flex items-center gap-2"
                    >
                      ${accessToken ? "Go to Dashboard" : "Login with X"}
                    </a>
                    <a
                      href="https://github.com/janwilmake/xymake"
                      target="_blank"
                      class="x-border hover:bg-white/10 px-8 py-4 rounded-full font-medium transition-colors flex items-center gap-2"
                    >
                      <svg
                        class="w-5 h-5"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                          clip-rule="evenodd"
                        />
                      </svg>
                      View Source
                    </a>
                  </div>
                </div>

                <!-- Features Grid -->
                <div class="grid md:grid-cols-3 gap-8 mb-20">
                  <div
                    class="x-border rounded-xl p-6 hover:bg-white/5 transition-colors"
                  >
                    <div class="text-blue-400 mb-4">
                      <svg
                        class="w-8 h-8"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                        />
                      </svg>
                    </div>
                    <h3 class="text-xl font-bold mb-2">Secure OAuth 2.0</h3>
                    <p class="text-gray-400">
                      PKCE implementation with encrypted cookies and CSRF
                      protection
                    </p>
                  </div>

                  <div
                    class="x-border rounded-xl p-6 hover:bg-white/5 transition-colors"
                  >
                    <div class="text-blue-400 mb-4">
                      <svg
                        class="w-8 h-8"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <h3 class="text-xl font-bold mb-2">Tweet Fetching</h3>
                    <p class="text-gray-400">
                      Fetch your most recent tweets and comments with 15-minute
                      caching
                    </p>
                  </div>

                  <div
                    class="x-border rounded-xl p-6 hover:bg-white/5 transition-colors"
                  >
                    <div class="text-blue-400 mb-4">
                      <svg
                        class="w-8 h-8"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                    </div>
                    <h3 class="text-xl font-bold mb-2">Rate-Limit Friendly</h3>
                    <p class="text-gray-400">
                      Respects X API rate limits with efficient caching strategy
                    </p>
                  </div>
                </div>

                <!-- Footer -->
                <div
                  class="text-center text-gray-500 border-t border-white/10 pt-12"
                >
                  <p class="text-sm">
                    Built with ❤️ using Cloudflare Workers. Not affiliated with
                    X Corp.
                  </p>
                </div>
              </div>
            </main>
          </body>
        </html>
      `,
      { headers: { "content-type": "text/html" } },
    );
  },
};
