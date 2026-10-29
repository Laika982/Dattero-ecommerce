export const isAjaxRequest = (req) =>
  Boolean(
    req?.xhr ||
    req?.headers?.["x-requested-with"] === "XMLHttpRequest" ||
    req?.headers?.accept?.includes("application/json") ||
    req?.headers?.["content-type"]?.includes("application/json") ||
    req?.headers?.["sec-fetch-dest"] === "empty"
  );

export default isAjaxRequest;
