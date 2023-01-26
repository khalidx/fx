import router from '../lib/router'

export const handler = router({
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
