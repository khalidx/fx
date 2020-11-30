import { App, Construct, Stack, StackProps, CfnOutput, Duration } from '@aws-cdk/core'
import { NodejsFunction, NodejsFunctionProps } from '@aws-cdk/aws-lambda-nodejs'
import { Queue, QueueProps } from '@aws-cdk/aws-sqs'
import { SqsEventSource, DynamoEventSource, SqsDlq } from '@aws-cdk/aws-lambda-event-sources'
import { StartingPosition } from '@aws-cdk/aws-lambda'
import { Table, TableProps, AttributeType, StreamViewType, BillingMode } from '@aws-cdk/aws-dynamodb'
import { LambdaProxyIntegration } from '@aws-cdk/aws-apigatewayv2-integrations'
import { DomainName, DomainNameProps, HttpApi, HttpApiProps, HttpMethod } from '@aws-cdk/aws-apigatewayv2'
import { ARecord, IHostedZone, RecordTarget } from '@aws-cdk/aws-route53'
import { ApiGatewayv2Domain } from '@aws-cdk/aws-route53-targets'
import { BlockPublicAccess, Bucket, BucketEncryption, BucketProps } from '@aws-cdk/aws-s3'

import { basename, extname, resolve } from 'path'

const lambdaFunction =
  (filename: string) =>
  (handler: string) =>
  (props?: Partial<NodejsFunctionProps>) =>
  (scope: Construct) => {
    const functionName = basename(filename, extname(filename))
    const functionResource = new NodejsFunction(scope, `LambdaFunction${functionName}`, {
      entry: resolve(filename),
      handler,
      sourceMap: true,
      ...props
    })
    return {
      functionName,
      functionResource
    }
  }

const queue =
  (lambdaFn: ReturnType<ReturnType<ReturnType<ReturnType<typeof lambdaFunction>>>>) =>
  (props?: Partial<QueueProps>) =>
  (scope: Construct) => {
    const queueResource = new Queue(scope, `QueueForLambdaFunction${lambdaFn.functionName}`, props)
    lambdaFn.functionResource.addEventSource(new SqsEventSource(queueResource))
    return {
      queueResource
    }
  }

const table =
  (lambdaFn: ReturnType<ReturnType<ReturnType<ReturnType<typeof lambdaFunction>>>>) =>
  (q: ReturnType<ReturnType<ReturnType<typeof queue>>>) =>
  (props?: Partial<TableProps>) =>
  (scope: Construct) => {
    const tableResource = new Table(scope, `TableForLambdaFunction${lambdaFn.functionName}`, {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_IMAGE,
      ...props
    })
    tableResource.grantReadWriteData(lambdaFn.functionResource)
    lambdaFn.functionResource.addEventSource(new DynamoEventSource(tableResource, {
      startingPosition: StartingPosition.TRIM_HORIZON,
      maxRecordAge: Duration.days(7),
      maxBatchingWindow: Duration.seconds(0),
      parallelizationFactor: 1,
      batchSize: 10,
      bisectBatchOnError: true,
      onFailure: new SqsDlq(q.queueResource),
      retryAttempts: 10
    }))
    return {
      tableResource
    }
  }

const httpApi =
  (lambdaFns: Array<ReturnType<ReturnType<ReturnType<ReturnType<typeof lambdaFunction>>>>>) =>
  (props?: Partial<HttpApiProps>) =>
  (scope: Construct) => {
    const httpApi = new HttpApi(scope, `HttpApiForLambdaFunctions`, props)
    const httpApiEndpoint = new CfnOutput(scope, `HttpApiEndpointForLambdaFunctions`, {
      value: httpApi.apiEndpoint
    })
    const integrations = lambdaFns.map(lambdaFn => {
      const lambdaProxyIntegration = new LambdaProxyIntegration({
        handler: lambdaFn.functionResource
      })
      const httpRoutes = [
        httpApi.addRoutes({
          path: `/${lambdaFn.functionName}`,
          methods: [ HttpMethod.ANY ],
          integration: lambdaProxyIntegration,
        }),
        httpApi.addRoutes({
          path: `/${lambdaFn.functionName}/{proxy+}`,
          methods: [ HttpMethod.ANY ],
          integration: lambdaProxyIntegration,
        })
      ]
      return {
        lambdaProxyIntegration,
        httpRoutes
      }
    })
    return {
      httpApi,
      httpApiEndpoint,
      integrations
    }
  }

const bucket =
  (lambdaFns: Array<ReturnType<ReturnType<ReturnType<ReturnType<typeof lambdaFunction>>>>>) =>
  (props?: Partial<BucketProps>) =>
  (scope: Construct) => {
    const bucketResource = new Bucket(scope, 'BucketForLambdaFunctions', {
      encryption: BucketEncryption.KMS_MANAGED,
      blockPublicAccess: new BlockPublicAccess({
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true
      }),
      ...props
    })
    lambdaFns.forEach(lambdaFn => {
      bucketResource.grantReadWrite(lambdaFn.functionResource, `${lambdaFn.functionName}/*`)
    })
    return {
      bucketResource
    }
  }

const domain =
  (props: DomainNameProps) =>
  (zone: IHostedZone) =>
  (scope: Construct) => {
    const customDomain = new DomainName(scope, 'HttpApiDomain', props)
    const parts = props.domainName.split('.'); parts.pop(); parts.pop();
    const record = new ARecord(scope, 'HttpApiDomainAliasRecord', {
      recordName: parts.length > 0 ? parts.join('.') : undefined,
      zone,
      target: RecordTarget.fromAlias(new ApiGatewayv2Domain(customDomain))
    })
    const httpApiProps: HttpApiProps = {
      defaultDomainMapping: {
        domainName: customDomain
      }
    }
    return {
      customDomain,
      record,
      httpApiProps
    }
  }

export const func =
  (filename: Parameters<typeof lambdaFunction>[0], implementation = { lambdaFunction, queue, table }) =>
  (scope: Construct) => {
    const fn = implementation.lambdaFunction(filename)('handler')()(scope)
    const q = implementation.queue(fn)()(scope)
    const t = implementation.table(fn)(q)()(scope)
    return {
      fn,
      q,
      t
    }
  }

const environment =
  (funcs: Array<ReturnType<ReturnType<typeof func>>>) =>
  (b: ReturnType<ReturnType<ReturnType<typeof bucket>>>) => {
    funcs.forEach(func => {
      func.fn.functionResource.addEnvironment('AWS_DYNAMODB_TABLE_NAME', func.t.tableResource.tableName)
      func.fn.functionResource.addEnvironment('AWS_S3_BUCKET_NAME', b.bucketResource.bucketName)
      func.fn.functionResource.addEnvironment('AWS_S3_BUCKET_PREFIX', `/${func.fn.functionName}/`)
    })
    return {}
  }

/**
 * Easily spins up a stack of Lambda Functions, each built from a TypeScript file,
 * with a bunch of event sources out of the box.
 * 
 * It's the fastest way for getting a scalable service up and online.
 *
 * Each function gets an API route, and a queue.
 * Functions in the same stack share the same API.
 * 
 * That's it!
 * 
 * Deploy with:
 * npx cdk --app "npx ts-node src/cdk.ts" deploy
 */
export const infrastructure =
  (functions: Array<ReturnType<typeof func>>, implementation = { bucket, httpApi, domain, environment }) =>
  (options?: Parameters<typeof implementation.domain>[0]) =>
  (zone?: IHostedZone) =>
  (stackname: string | Construct) => {
    const stack = (typeof stackname === 'string')
      ? new Stack(new App(), stackname)
      : stackname
    const domain = options && zone ? implementation.domain(options)(zone)(stack) : undefined
    const fns = functions.map(fn => fn(stack))
    const api = implementation.httpApi(fns.map(fn => fn.fn))(domain?.httpApiProps)(stack)
    const bucket = implementation.bucket(fns.map(fn => fn.fn))()(stack)
    const environment = implementation.environment(fns)(bucket)
    return {
      domain,
      api,
      fns,
      environment,
      bucket,
      stack
    }
  }

export class FunctionStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
    infrastructure([
      func('src/examples/hello.ts'),
      func('src/examples/goodbye.ts'),
      func('src/examples/express.ts'),
      func('src/examples/write.ts')
    ])()()(this)
  }
}

new FunctionStack(new App(), 'function-stack')
