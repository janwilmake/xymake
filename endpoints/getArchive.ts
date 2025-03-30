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
  // 1) Finish zipobject $ref parsing
  // 2) Finish zipobject html response
  // 3) Find the right way to charge for this. Best would be building this out for anyone for a max cost of $0.50 putting as much valuable info in there. Then, if you want your entire dataset and have it continuously updated, donate $100 and it'd be good for 6 months (calculated based on some stats of your profile). Besides that it'd be great to incentivize people to also get the people they interacted most with in there too.

  return fetch(`https://zipobject.com/xymake.com/${username}.json`, {
    headers,
  });
};
