import router from '../lib/router'

import express from 'express'

const app = express()

app.use((req, res) => {
  res.json({
    query: req.query
  })
})

export const handler = router({
  api: {
    express: app
  }
})
