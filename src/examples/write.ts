import router from '../lib/router'

import { DynamoDB } from 'aws-sdk'
import { v4 as uuid } from 'uuid'

const dynamo = new DynamoDB.DocumentClient()

export const handler = router({
  api: {
    proxyV2: async (event) => {
      if (event.requestContext.http.method === 'POST') {
        if (event.body) {
          const body = JSON.parse(event.body)
          if (body && body.item && typeof body.item === 'string') {
            const Item = {
              id: uuid(),
              item: body.item
            }
            await dynamo.put({ TableName: process.env.AWS_DYNAMODB_TABLE_NAME!, Item }).promise()
            return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(Item)
            }
          }
        }
      }
      return {
        statusCode: 400
      }
    }
  }
})
