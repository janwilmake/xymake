import { Env, getSubscriber } from "../xLoginMiddleware.js";

function isTweetId(id: any) {
  // Ensure it's a string or number and consists only of digits
  if (typeof id !== "string" && typeof id !== "number") return false;
  const idStr = String(id);
  if (!/^\d+$/.test(idStr)) {
    console.log("No valid");
    return false;
  }

  // Check length (tweet IDs are typically 18-19 digits)
  if (idStr.length < 18 || idStr.length > 19) {
    return false;
  }
  return true;
}

/** Endpoint /login/reply|quote|new[/tweet_id]/text */
export const postTweets = async (request: Request, env: Env, ctx: any) => {
  const url = new URL(request.url);

  const subscriber = await getSubscriber(request, env);
  const { access_token, newAccessToken, error } = subscriber;

  const setCookieHeader: { [key: string]: string } = newAccessToken
    ? {
        "Set-Cookie": `x_access_token=${encodeURIComponent(
          newAccessToken,
        )}; Domain=xymake.com; HttpOnly; Path=/; Secure; SameSite=Lax; Max-Age=34560000`,
      }
    : {};

  const loginUrl = `https://xymake.com/login?scope=${encodeURIComponent(
    "users.read follows.read tweet.read offline.access tweet.write",
  )}`;

  if (!access_token) {
    return new Response(
      `Unauthorized. Please login first.\n\n${loginUrl}\n\n Error = ${error}`,
      {
        status: 401,
        headers: { Location: loginUrl },
      },
    );
  }

  const [username, action, ...rest] = url.pathname.split("/").slice(1);
  const actions = ["reply", "quote", "new"];

  if (!username || !actions.includes(action)) {
    return new Response("Usage: /username/new|quote|reply[/tweet_id]/...text", {
      status: 400,
      headers: setCookieHeader,
    });
  }

  const needTweetId = action === "reply" || action === "quote";

  const tweet_id = needTweetId ? rest[0] : undefined;
  if (needTweetId && !isTweetId(tweet_id)) {
    return new Response(`Usage: /${username}/${action}/tweet_id/...text`, {
      status: 400,
      headers: setCookieHeader,
    });
  }

  const text = needTweetId
    ? decodeURIComponent(rest.slice(1).join("/"))
    : decodeURIComponent(rest.join("/"));

  // Prepare the API request based on the action
  let endpoint = "https://api.twitter.com/2/tweets";
  let requestBody: any = { text };

  // Handle reply and quote actions
  if (action === "reply") {
    requestBody.reply = { in_reply_to_tweet_id: tweet_id };
  } else if (action === "quote") {
    // For quotes, we need to include the quoted tweet URL in the text
    // This is how X handles quotes in the v2 API
    // const quotedTweetUrl = `https://twitter.com/i/web/status/${tweet_id}`;
    // requestBody.text = `${text} ${quotedTweetUrl}`;
    requestBody.quote_tweet_id = tweet_id;
  }

  try {
    // Make the API request to create the tweet
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        // "User-Agent": "XYMake",
      },
      body: JSON.stringify(requestBody),
    });

    const data: any = await response.json();

    if (response.status === 403) {
      return new Response(
        JSON.stringify(
          {
            error: `403 Unauthorized - Please login with the tweet.write scope.\n\n${loginUrl}`,
            details: data,
          },
          undefined,
          2,
        ),
        {
          status: response.status,
          headers: {
            "Content-Type": "application/json",
            Location: loginUrl,
            ...setCookieHeader,
          },
        },
      );
    }
    if (!response.ok) {
      return new Response(
        JSON.stringify(
          { error: "Failed to create tweet", details: data },
          undefined,
          2,
        ),
        {
          status: response.status,
          headers: { "Content-Type": "application/json", ...setCookieHeader },
        },
      );
    }

    return new Response(
      JSON.stringify(
        {
          success: true,
          tweet_id: data.data.id,
          text: requestBody.text,
          action,
        },
        undefined,
        2,
      ),
      { headers: { "Content-Type": "application/json", ...setCookieHeader } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify(
        { error: "Error creating tweet", message: error.message },
        undefined,
        2,
      ),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...setCookieHeader },
      },
    );
  }
};
