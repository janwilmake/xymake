import { Env } from "../xLoginMiddleware.js";

export const getArchive = async (request: Request, env: Env, ctx: any) => {
  const url = new URL(request.url);
  const [first] = url.pathname.split("/").slice(1);
  const username = first.split(".")[0];
  // Build zip simply by dereferencing all the JSON starting from `janwilmake.json`
  // const headers = {Authorization:`Bearer ${env.ZIPOBJECT_API_KEY}`}
  const headers = undefined;
  return fetch(`https://zipobject.com/xymake.com/${username}.json`, {
    headers,
  });
};
