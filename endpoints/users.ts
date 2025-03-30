import { Env } from "../getThreadData.js";

export default {
  fetch: async (request: Request, env: Env) => {
    const list = await env.TWEET_KV.list({ prefix: "user:" });

    const keys: string[] = list.keys.map((x) => x.name.split(":")[1]);

    if (request.url.endsWith(".json")) {
      return new Response(JSON.stringify(keys, undefined, 2), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(keys.map((x) => `@${x}`).join(", "), {
      headers: { "content-type": "text/markdown" },
    });
  },
};
