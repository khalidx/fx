# fx

Instantly deploy functions to the cloud.

The fastest way to get a scalable service up and online.

> A powerful infrastructure abstraction built with the AWS CDK.

> "Wow, you are going to be *so* productive now."
> --not-so-anonymous user feedback

## Usage

Clone this project. It's yours now! 

The [cdk.ts](./src/cdk.ts) file contains a convenient wrapper around the `aws-cdk`.

The [hello.ts](./src/hello.ts) function file is a plain old AWS Lambda Function handler.

You can run this to deploy:

```shell
npm install && npm run deploy
```

Just make sure you have AWS credentials locally as well as `node` and `npm`.

## What does it do?

It contains some convenience functions that are used at deploy time to get
you some cloud goodness!

> Every referenced function will be deployed
> along with its associated cloud infrastructure
> (API Gateway, SQS Queue).

It deploys an API -> Lambda Function, so that you can respond to API requests.
It deploys SQS -> Lambda Function, so you can react to queue events.

All from the same function. A powerful paradigm and simple programming model.

## How can I add more than one function?

At the bottom of the `src/cdk.ts` file, just configure the paths to your lambda function entrypoints.

## Benchmarks

> Generates <2KB lambda functions with no runtime dependencies

- deploy no changes: 0m4.446s
- deploy with changes: 0m46.369s | 1m6.943s

## Support

That's all there is to it!

Open a GitHub issue to ask a question, report a bug, raise a concern, or request a new feature.

Also, your question may already be answered on the following [Hacker News thread](https://news.ycombinator.com/item?id=25236969).

Thanks for reading, and for making it all the way down here!
