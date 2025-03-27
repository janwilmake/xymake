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

// console.log(isTweetId("1905227667357544768"));

/** Endpoint /login/reply|quote|new[/tweet_id]/text */
export const makeThread = async (request: Request, env: any, ctx: any) => {
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
  const loginUrl = `https://xymake.com/login?scope=${encodeURIComponent(
    "users.read follows.read tweet.read offline.access tweet.write",
  )}`;

  if (!accessToken) {
    return new Response(`Unauthorized. Please login first.\n\n${loginUrl}`, {
      status: 403,
      headers: { Location: loginUrl },
    });
  }

  const [login, action, ...rest] = url.pathname.split("/").slice(1);
  const actions = ["reply", "quote", "new"];
  if (!login || !actions.includes(action)) {
    return;
  }
  const needTweetId = action === "reply" || action === "quote";
  const tweet_id = needTweetId ? rest[0] : undefined;
  if (needTweetId && !isTweetId(tweet_id)) {
    return new Response(`Usage: /${login}/${action}/tweet_id/...text`, {
      status: 400,
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
        Authorization: `Bearer ${accessToken}`,
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
          headers: { "Content-Type": "application/json", Location: loginUrl },
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
          headers: { "Content-Type": "application/json" },
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
      { headers: { "Content-Type": "application/json" } },
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
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
