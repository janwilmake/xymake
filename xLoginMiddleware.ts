export type UserConfig = { privacy: "private" | "public" };

// OAuth helpers
export async function generateRandomString(length: number): Promise<string> {
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// HTML template helper
const html = (strings: TemplateStringsArray, ...values: any[]) => {
  return strings.reduce(
    (result, str, i) => result + str + (values[i] || ""),
    "",
  );
};

async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Env = any;
export const xLoginMiddleware = async (
  request: Request,
  env: Env,
  ctx: any,
) => {
  const url = new URL(request.url);
  const cookie = request.headers.get("Cookie") || "";
  const rows = cookie.split(";").map((x) => x.trim());

  // Get X access token from cookies
  const xAccessToken = rows
    .find((row) => row.startsWith("x_access_token="))
    ?.split("=")[1]
    ?.trim();

  const adminPassword = rows
    .find((row) => row.startsWith("password="))
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

      await env.TWEET_KV.put(
        `user:${username}`,
        JSON.stringify({ privacy: "public" } satisfies UserConfig),
      );

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
              <p>${error instanceof Error ? error.message : "Unknown error"}</p>
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

  if (url.pathname.endsWith("/sqlite")) {
    if (!adminPassword || adminPassword !== env.X_CLIENT_SECRET) {
      return new Response("Please enter a password as cookie 'password'", {
        status: 404,
      });
    }
    const name = url.pathname.split("/")[1];
    const id = env.X_FEED.idFromName(name);
    const stub = env.X_FEED.get(id);
    return stub.fetch(request) as Response;
  }
  return undefined;
};
