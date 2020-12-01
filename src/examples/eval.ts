import { APIGatewayProxyHandler } from 'aws-lambda'

import { execSync } from 'child_process'

export const handler: APIGatewayProxyHandler = async () => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      result: execSync('node -e "console.log(2+2)"').toString('utf-8').trim()
    })
  }
}
