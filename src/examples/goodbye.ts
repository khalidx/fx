import { Handler } from 'aws-lambda'
import router from '../router'

export const handler: Handler = (event, context, callback) => router(event, context, callback, {
  api: {
    proxyV2: async (event) => {
      console.log('http api event received', event.requestContext.requestId)
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Goodbye!' })
      }
    }
  },
  queue: async (event) => {
    console.log('sqs queue event received', event.Records.length)
  },
  stream: async (event) => {
    console.log('dynamodb stream event received', event.Records.length)
  }
})
