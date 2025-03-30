import { getFormat } from "../getFormat.js";
import { Env } from "../xLoginMiddleware.js";

export const getArchive = async (request: Request, env: Env, ctx: any) => {
  const url = new URL(request.url);
  const [first] = url.pathname.split("/").slice(1);
  const username = first.split(".")[0];
  const format = getFormat(request);
  if (!format) {
    return new Response("Unsupported format", { status: 400 });
  }

  // Build zip simply by dereferencing all the JSON starting from `janwilmake.json`
  const headers = {
    Authorization: `Bearer ${env.ZIPOBJECT_API_KEY}`,
    accept: format,
  };
  // TODO:

  // 0) use $ref properly
  // 1) add authorization header support
  // 2) Finish zipobject $ref parsing including proper authorization header support
  // 3) Make accessible in the new uithub (universal information terminal)
  // 4) Build out free archive of max $1 for any profile, expect payment for full archive.

  return fetch(`https://zipobject.com/xymake.com/${username}.json`, {
    headers,
  });
};
