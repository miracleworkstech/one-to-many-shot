// Railway healthcheck (railway.json) and the middleware matcher both exempt this path.
export const GET = () => new Response("ok");
