export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "yuyakevinito.com" && url.protocol === "http:") {
      url.protocol = "https:";
      url.port = "";
      return Response.redirect(url.href, 301);
    }

    const response = await env.ASSETS.fetch(request);

    if (url.hostname.endsWith(".workers.dev")) {
      const preview = new Response(response.body, response);
      preview.headers.set("X-Robots-Tag", "noindex");
      return preview;
    }

    return response;
  },
};
