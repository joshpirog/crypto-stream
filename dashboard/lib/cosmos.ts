import { CosmosClient, Container } from "@azure/cosmos";

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE ?? "market";

let client: CosmosClient | null = null;

// Lazily construct the client so `next build` (which never calls these handlers,
// they're force-dynamic) doesn't require the env vars to be present at build time.
function getClient(): CosmosClient {
  if (!endpoint || !key) {
    throw new Error("COSMOS_ENDPOINT and COSMOS_KEY must be set");
  }
  if (!client) {
    client = new CosmosClient({ endpoint, key });
  }
  return client;
}

export function container(name: string): Container {
  return getClient().database(databaseId).container(name);
}
