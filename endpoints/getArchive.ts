import { Env } from "../xLoginMiddleware.js";

export const getArchive = async (request: Request, env: Env, ctx: any) => {
  const url = new URL(request.url);
  const [first] = url.pathname.split("/").slice(1);
  const username = first.split(".")[0];
  // build zip simply by dereferencing all the JSON

  return new Response("Archive coming soon");
};
