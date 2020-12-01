import { APIGatewayProxyHandler } from 'aws-lambda'

export const handler: APIGatewayProxyHandler = async (event, context) => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: 'Wow, you are going to be *so* productive now.',
      requestId: event.requestContext.requestId,
      functionName: context.functionName
    })
  }
}
