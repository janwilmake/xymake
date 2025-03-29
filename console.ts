import console from "./console.html";
import { identify } from "./identify.js";
import { Env } from "./xLoginMiddleware.js";

export const handleConsole = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | undefined> => {
  const url = new URL(request.url);

  // Check if this is the dashboard endpoint
  if (url.pathname !== "/console") {
    return undefined;
  }

  const { isBrowser } = identify(request);
  if (!isBrowser) {
    return new Response(
      "Bad request: Dashboard is only available in browsers",
      { status: 400 },
    );
  }

  // Get access token from cookies
  const cookie = request.headers.get("Cookie") || "";
  const rows = cookie.split(";").map((x) => x.trim());
  const xAccessToken = rows
    .find((row) => row.startsWith("x_access_token="))
    ?.split("=")[1]
    ?.trim();

  const accessToken = xAccessToken ? decodeURIComponent(xAccessToken) : null;

  if (!accessToken) {
    // Redirect to login if not authenticated
    return new Response("Unauthorized", {
      status: 307,
      headers: {
        Location:
          "/login?scope=users.read%20follows.read%20tweet.read%20offline.access%20tweet.write",
      },
    });
  }

  try {
    // Check token scopes by making a request to X API
    const scopeResponse = await fetch("https://api.x.com/2/oauth2/token/info", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    let hasTweetScope = false;
    if (scopeResponse.ok) {
      try {
        const tokenInfo: any = await scopeResponse.json();
        const scopes = tokenInfo?.scopes || [];
        hasTweetScope = scopes.includes("tweet.write");
      } catch {}
    }

    // Also get username for display
    const userResponse = await fetch(
      "https://api.x.com/2/users/me?user.fields=username,profile_image_url",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (userResponse.status === 401 || userResponse.status === 403) {
      // Redirect to login if not authenticated
      return new Response("Unauthorized", {
        status: 307,
        headers: {
          Location:
            "/login?scope=users.read%20follows.read%20tweet.read%20offline.access%20tweet.write",
        },
      });
    }
    if (!userResponse.ok) {
      throw new Error(`Failed to fetch user data: ${userResponse.status}`);
    }

    const userData: any = await userResponse.json();
    const { username, profile_image_url } = userData.data;

    // Replace placeholders in the dashboard HTML
    let dashboardHtml = console
      .replaceAll("{{username}}", username)
      .replaceAll("{{profile_image_url}}", profile_image_url)
      .replaceAll("{{apiKey}}", accessToken)
      .replaceAll("{{hasTweetScope}}", hasTweetScope ? "true" : "false");

    return new Response(dashboardHtml, {
      headers: { "content-type": "text/html;charset=utf8" },
    });
  } catch (error: any) {
    return new Response(
      `Error loading dashboard: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      {
        status: 500,
      },
    );
  }
};
