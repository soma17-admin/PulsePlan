// PulsePlan IaC 진입점(azd 표준 구독 스코프).
// 리소스 그룹을 만들고, 그 안에 클라우드 네이티브 리소스를 모듈로 배치한다.
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('azd 환경 이름 — 리소스 이름 파생에 사용.')
param environmentName string

@minLength(1)
@description('모든 리소스의 기본 위치.')
param location string

@description('Azure OpenAI(Foundry) 엔드포인트.')
param azureOpenAiEndpoint string = ''

@description('Azure OpenAI 배포(모델) 이름.')
param azureOpenAiDeployment string = 'gpt-4o'

@description('Azure OpenAI API 버전.')
param azureOpenAiApiVersion string = '2024-10-21'

@description('Azure OpenAI API 키 — Key Vault 에만 저장.')
@secure()
param azureOpenAiApiKey string

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'pulseplan-resources'
  scope: rg
  params: {
    location: location
    resourceToken: resourceToken
    tags: tags
    azureOpenAiEndpoint: azureOpenAiEndpoint
    azureOpenAiDeployment: azureOpenAiDeployment
    azureOpenAiApiVersion: azureOpenAiApiVersion
    azureOpenAiApiKey: azureOpenAiApiKey
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.registryLoginServer
output AZURE_KEY_VAULT_NAME string = resources.outputs.keyVaultName
output SERVICE_WEB_URI string = resources.outputs.webUri
