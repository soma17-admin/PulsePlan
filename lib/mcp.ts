export const azureMcpServers = {
  "azure-mcp": {
    type: "local",
    command: "npx",
    args: ["-y", "@azure/mcp@latest", "server", "start"],
    tools: [
      "azure_resources_list",
      "azure_resource_groups_list",
      "azure_cosmosdb_list",
    ],
    timeout: 30000,
  },
};
