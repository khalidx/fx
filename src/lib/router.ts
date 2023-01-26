import type { Handler, APIGatewayProxyHandler, APIGatewayProxyHandlerV2, SQSHandler, SNSHandler, DynamoDBStreamHandler, ScheduledHandler, APIGatewayProxyEvent, APIGatewayProxyEventV2, SQSEvent, SNSEvent, DynamoDBStreamEvent, ScheduledEvent } from 'aws-lambda'
import type { Express } from 'express'
import serverless from 'serverless-http'

/**
 * A Lambda handler router that determines the proper handler to use based on the type of the received event.
 */
export const router = (handlers: {
  readonly api?: {
    readonly proxy?: APIGatewayProxyHandler
    readonly proxyV2?: APIGatewayProxyHandlerV2
    readonly express?: Express
    readonly serverless?: ReturnType<typeof serverless>
  }
  readonly queue?: SQSHandler
  readonly topic?: SNSHandler
  readonly stream?: DynamoDBStreamHandler 
  readonly scheduled?: ScheduledHandler }): Handler => (event, context, callback) => {
  const isProxyEvent = (event as APIGatewayProxyEvent).httpMethod
  const isProxyV2Event = (event as APIGatewayProxyEventV2).requestContext?.http?.method
  const isApiEvent = isProxyEvent || isProxyV2Event
  if (isProxyEvent && handlers.api?.proxy) return handlers.api.proxy(event, context, callback)
  else if (isProxyV2Event && handlers.api?.proxyV2) return handlers.api.proxyV2(event, context, callback)
  else if (isApiEvent && handlers.api?.express) return serverless(handlers.api.express)(event, context)
  else if (isApiEvent && handlers.api?.serverless) return handlers.api.serverless(event, context)
  else if ((event as SQSEvent).Records && ((event as SQSEvent).Records[0].eventSource === 'aws:sqs') && handlers.queue) return handlers.queue(event, context, callback)
  else if ((event as SNSEvent).Records && ((event as SNSEvent).Records[0].EventSource === 'aws:sns') && handlers.topic) return handlers.topic(event, context, callback)
  else if ((event as DynamoDBStreamEvent).Records && ((event as DynamoDBStreamEvent).Records[0].eventSource === 'aws:dynamodb') && handlers.stream) return handlers.stream(event, context, callback)
  else if ((event as ScheduledEvent).source === 'aws.events' && handlers.scheduled) return handlers.scheduled(event, context, callback)
  else throw new Error('Unroutable unsupported event type received.')
}

export default router
