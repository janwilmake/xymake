import { stringify } from "yaml";

/** Needs to be further improved using `getFormat` */
export const getDataResponse = (data: any, format: string) => {
  if (format === "application/json") {
    return new Response(JSON.stringify(data, undefined, 2), {
      headers: { "content-type": "application/json;charset=utf8" },
    });
  }
  return new Response(stringify(data), {
    headers: { "content-type": "text/yaml;charset=utf8" },
  });
};
