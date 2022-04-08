import { TokenCredential } from "@azure/identity";
import chalk from "chalk";
import { Command } from "commander";
import process from "process";
import { DEFAULT_CONFIG } from "../../config";
import { configureOptions, logger } from "../../core";
import { swaCLIEnv } from "../../core/env";
import { azureLoginWithIdentitySDK, listResourceGroups, listStaticSites, listSubscriptions, listTenants } from "../../core/account";
import { chooseResourceGroup, chooseStaticSite, chooseSubscription, chooseTenant } from "../../core/prompts";
import { Environment } from "../../core/swa-cli-persistence-plugin/impl/azure-environment";

export function addSharedLoginOptionsToCommand(command: Command) {
  command
    .option("--subscription [subscriptionId]", "Azure subscription ID used by this project", DEFAULT_CONFIG.subscriptionId)
    .option("--resource-group [resourceGroup]", "Azure resource group used by this project", DEFAULT_CONFIG.resourceGroupName)
    .option("--tenant [tenantId]", "Azure tenant ID", DEFAULT_CONFIG.tenantId)
    .option("--client-id [clientId]", "Azure client ID", DEFAULT_CONFIG.clientId)
    .option("--client-secret [clientSecret]", "Azure client secret", DEFAULT_CONFIG.clientSecret)
    .option("--app-name [appName]", "Azure Static Web App application name", DEFAULT_CONFIG.appName);
}

export default function registerCommand(program: Command) {
  const loginCommand = program
    .command("login")
    .usage("[options]")
    .description("login into Azure Static Web Apps")
    .option("--use-keychain <keychain>", "Enable credentials cache persistence", DEFAULT_CONFIG.useKeychain)
    .action(async (_options: SWACLIConfig, command: Command) => {
      const config = await configureOptions(undefined, command.optsWithGlobals(), command);
      await login(config.options);

      logger.log(chalk.green(`✔ Logged in successfully to ${Environment.AzureCloud.name}!`));
    })
    .addHelpText(
      "after",
      `
Examples:

  Interactive login
  swa login

  Interactive login without storing credentials
  swa login --useKeychain false

  Login into specific tenant
  swa login --tenant 12345678-abcd-0123-4567-abcdef012345

  Login using service principal
  swa login --tenant 12345678-abcd-0123-4567-abcdef012345 \\
            --client-id 00000000-0000-0000-0000-000000000000 \\
            --client-secret 0000000000000000000000000000000000000000000000000000000000000000
    `
    );
  addSharedLoginOptionsToCommand(loginCommand);
}

export async function login(options: SWACLIConfig) {
  const { AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, SWA_CLI_APP_NAME, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = swaCLIEnv();

  let credentialChain: TokenCredential | undefined = undefined;

  let subscriptionId: string | undefined = AZURE_SUBSCRIPTION_ID ?? options.subscriptionId;
  let resourceGroupName: string | undefined = AZURE_RESOURCE_GROUP ?? options.resourceGroupName;
  let staticSiteName: string | undefined = SWA_CLI_APP_NAME ?? options.appName;
  let tenantId: string | undefined = AZURE_TENANT_ID ?? options.tenantId;
  let clientId: string | undefined = AZURE_CLIENT_ID ?? options.clientId;
  let clientSecret: string | undefined = AZURE_CLIENT_SECRET ?? options.clientSecret;

  try {
    credentialChain = await azureLoginWithIdentitySDK({ tenantId, clientId, clientSecret }, options.useKeychain);

    // If the user has not specified a tenantId, we will prompt them to choose one
    if (!tenantId) {
      const tenants = await listTenants(credentialChain);
      if (tenants.length === 0) {
        throw new Error("No tenants found. Aborting.");
      } else if (tenants.length === 1) {
        logger.silly("A single tenant found");
        tenantId = tenants[0].tenantId;
      } else {
        const tenant = await chooseTenant(tenants, options.tenantId);
        tenantId = tenant.tenantId;
        // login again with the new tenant
        // TODO: can we silently authenticate the user with the new tenant?
        credentialChain = await azureLoginWithIdentitySDK({ tenantId, clientId, clientSecret }, options.useKeychain);
      }
    }

    logger.silly({ tenant: tenantId });

    // If the user has not specified a subscriptionId, we will prompt them to choose one
    subscriptionId = options.subscriptionId;
    if (!subscriptionId) {
      const subscriptions = await listSubscriptions(credentialChain);
      if (subscriptions.length === 0) {
        throw new Error("No subscriptions found. Aborting.");
      } else if (subscriptions.length === 1) {
        logger.silly("A single subscription found");
        subscriptionId = subscriptions[0].subscriptionId;
      } else {
        const subscription = await chooseSubscription(subscriptions, options.subscriptionId);
        subscriptionId = subscription.subscriptionId;
      }
    }

    logger.silly({ subscriptionId });

    // If the user has not specified a resourceGroup, we will prompt them to choose one
    resourceGroupName = options.resourceGroupName;
    if (!options.resourceGroupName) {
      const resourceGroups = await listResourceGroups(credentialChain, subscriptionId);
      if (resourceGroups.length === 0) {
        // TODO: create a new resource group
        throw new Error("No resource groups found. Aborting.");
      } else if (resourceGroups.length === 1) {
        logger.silly("A single resource group found");
        resourceGroupName = resourceGroups[0].name;
      } else {
        const resourceGroup = await chooseResourceGroup(resourceGroups, options.resourceGroupName);
        resourceGroupName = resourceGroup.name;
      }
    }

    logger.silly({ resourceGroupName });

    // If the user has not specified a staticSite, we will prompt them to choose one
    staticSiteName = options.appName;
    if (!options.appName) {
      const staticSites = await listStaticSites(credentialChain, subscriptionId, resourceGroupName);
      if (staticSites.length === 0) {
        // TODO: create a new static site
        throw new Error("No static sites found. Aborting.");
        process.abort();
      } else if (staticSites.length === 1) {
        logger.silly("A single static site found");
        staticSiteName = staticSites[0].name;
      } else {
        const staticSite = await chooseStaticSite(staticSites, options.appName);
        staticSiteName = staticSite.name;
      }
    }

    logger.silly({ staticSiteName });
  } catch (error) {
    logger.error((error as any).message, true);
  }

  logger.silly({ subscriptionId, resourceGroupName, staticSiteName });

  return {
    credentialChain,
    subscriptionId,
    resourceGroupName,
    staticSiteName,
  };
}
