import { Handler } from 'aws-lambda'
import router from '../router'
import express from 'express'

const app = express()

app.use((req, res) => {
  res.json({
    query: req.query
  })
})

export const handler: Handler = (event, context, callback) => router(event, context, callback, {
  api: {
    express: app
  }
})
