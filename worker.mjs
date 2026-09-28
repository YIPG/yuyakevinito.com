export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "yuyakevinito.com" && url.protocol === "http:") {
      url.protocol = "https:";
      url.port = "";
      return Response.redirect(url.href, 301);
    }

    let response = await env.ASSETS.fetch(request);
    if (url.pathname === "/" && env.CF_VERSION_METADATA) {
      response = new Response(response.body, response);
      response.headers.set("X-Site-Version", env.CF_VERSION_METADATA.id);
      response.headers.set("X-Site-Version-Created", env.CF_VERSION_METADATA.timestamp);
    }

    if (url.hostname.endsWith(".workers.dev")) {
      const preview = new Response(response.body, response);
      preview.headers.set("X-Robots-Tag", "noindex");
      return preview;
    }

    return response;
  },
};
