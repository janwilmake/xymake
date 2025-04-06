import { corsHeaders } from "../router.js";
import { Env } from "../xLoginMiddleware.js";
import { UserState } from "../xLoginMiddleware.js";
import { getUserProfile } from "./getUserProfile.js";

export default {
  fetch: async (request: Request, env: Env, ctx: any) => {
    const url = new URL(request.url);

    const list = await env.TWEET_KV.list({ prefix: "user:" });

    const keys: string[] = list.keys.map((x) => x.name.split(":")[1]);

    if (url.pathname === "/users/details.json") {
      const responses = await Promise.all(
        keys.map((key) =>
          getUserProfile(new Request(`http://internal/${key}.json`), env, ctx)
            .then((res) => res.json())
            .then((json: any) => json?.["index.json"]),
        ),
      );
      return new Response(JSON.stringify(responses, undefined, 2), {
        headers: {
          "content-type": "application/json;charset=utf8",
          ...corsHeaders,
        },
      });
    }

    if (request.url.endsWith(".json")) {
      return new Response(JSON.stringify(keys, undefined, 2), {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }
    return new Response(keys.map((x) => `@${x}`).join(", "), {
      headers: { "content-type": "text/markdown", ...corsHeaders },
    });
  },
};
