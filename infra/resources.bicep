// PulsePlan 클라우드 네이티브 리소스(리소스 그룹 스코프).
// 관리 ID로 런타임 인증, 시크릿은 Key Vault, 관측은 App Insights/Log Analytics,
// 상태는 Cosmos DB, 스케일은 Container Apps 의 명시적 min/max 레플리카로 처리한다.

@description('모든 리소스를 만들 위치.')
param location string

@minLength(3)
@description('리소스 이름 충돌을 막는 고유 토큰.')
param resourceToken string

@description('공통 태그(azd 환경 표식 포함).')
param tags object

@description('Azure OpenAI(Foundry) 엔드포인트.')
param azureOpenAiEndpoint string

@description('Azure OpenAI 배포(모델) 이름.')
param azureOpenAiDeployment string

@description('Azure OpenAI API 버전.')
param azureOpenAiApiVersion string

@description('Azure OpenAI API 키 — 평문 env 가 아니라 Key Vault 에만 저장한다.')
@secure()
param azureOpenAiApiKey string

@description('첫 프로비전용 컨테이너 이미지. azd deploy 가 실제 이미지로 덮어쓴다.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

// ---- 관리 ID: 런타임 인증(ACR pull, Key Vault, Azure MCP)의 단일 주체 ----
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${resourceToken}'
  location: location
  tags: tags
}

// ---- 관측: Log Analytics + Application Insights ----
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${resourceToken}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ---- 시크릿: Key Vault(RBAC) ----
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    publicNetworkAccess: 'Enabled'
  }
}

resource aoaiSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'aoai-key'
  properties: {
    value: azureOpenAiApiKey
  }
}

resource cosmosSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'cosmos-key'
  properties: {
    value: cosmos.listKeys().primaryMasterKey
  }
}

// ---- 컨테이너 레지스트리 ----
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acr${resourceToken}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

// ---- 상태: Cosmos DB(서버리스 SQL) ----
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: 'cosmos-${resourceToken}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [{ name: 'EnableServerless' }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'pulseplan'
  properties: {
    resource: { id: 'pulseplan' }
  }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'sessions'
  properties: {
    resource: {
      id: 'sessions'
      partitionKey: { paths: ['/id'], kind: 'Hash' }
    }
  }
}

// ---- 역할 부여: 관리 ID 에 최소 권한만 ----
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, managedIdentity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      keyVaultSecretsUserRoleId
    )
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, managedIdentity.id, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      acrPullRoleId
    )
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---- Container Apps 환경(Log Analytics 연결) ----
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${resourceToken}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// ---- Container App: 관리 ID + Key Vault 시크릿 + 명시적 스케일 ----
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${resourceToken}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: managedIdentity.id
        }
      ]
      secrets: [
        {
          name: 'aoai-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/aoai-key'
          identity: managedIdentity.id
        }
        {
          name: 'cosmos-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/cosmos-key'
          identity: managedIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsights.properties.ConnectionString
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: managedIdentity.properties.clientId
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: azureOpenAiEndpoint
            }
            {
              name: 'AZURE_OPENAI_DEPLOYMENT'
              value: azureOpenAiDeployment
            }
            {
              name: 'AZURE_OPENAI_API_VERSION'
              value: azureOpenAiApiVersion
            }
            {
              name: 'AZURE_OPENAI_API_KEY'
              secretRef: 'aoai-key'
            }
            {
              name: 'COSMOS_ENDPOINT'
              value: cosmos.properties.documentEndpoint
            }
            {
              name: 'COSMOS_KEY'
              secretRef: 'cosmos-key'
            }
            {
              name: 'COSMOS_DATABASE'
              value: 'pulseplan'
            }
            {
              name: 'COSMOS_CONTAINER'
              value: 'sessions'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '20'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [
    kvSecretsUser
    acrPull
    aoaiSecret
    cosmosSecret
    cosmosContainer
  ]
}

output registryLoginServer string = registry.properties.loginServer
output webUri string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output keyVaultName string = keyVault.name
output managedIdentityClientId string = managedIdentity.properties.clientId
