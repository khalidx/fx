import { App, Stack, StackProps, CfnOutput, Duration, Names } from 'aws-cdk-lib'
import { Construct } from 'constructs'

import { Runtime } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs'
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam'
import { Queue, QueueProps, QueueEncryption } from 'aws-cdk-lib/aws-sqs'
import { SqsEventSource, DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { Table, TableProps, AttributeType, StreamViewType, BillingMode } from 'aws-cdk-lib/aws-dynamodb'
import { HttpLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha'
import { DomainName, DomainNameProps, HttpApi, HttpApiProps, HttpMethod, PayloadFormatVersion } from '@aws-cdk/aws-apigatewayv2-alpha'
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53'
import { ApiGatewayv2DomainProperties } from 'aws-cdk-lib/aws-route53-targets'
import { BlockPublicAccess, Bucket, BucketEncryption, BucketProps } from 'aws-cdk-lib/aws-s3'

import globby from 'globby'

import { basename, extname, resolve } from 'path'

const lambdaFunction =
  (filename: string) =>
  (handler: string) =>
  (props?: Partial<NodejsFunctionProps>) =>
  (scope: Construct) => {
    const functionName = basename(filename, extname(filename))
    const functionResource = new NodejsFunction(scope, `LambdaFunction-${functionName}`, {
      entry: resolve(filename),
      handler,
      runtime: Runtime.NODEJS_18_X,
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
    const queueResource = new Queue(scope, `QueueForLambdaFunction-${lambdaFn.functionName}`, {
      enforceSSL: true,
      encryption: QueueEncryption.KMS_MANAGED,
      ...props
    })
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
    const tableResource = new Table(scope, `TableForLambdaFunction-${lambdaFn.functionName}`, {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      sortKey: { name: 'version', type: AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
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
    const httpApi = new HttpApi(scope, `HttpApiForLambdaFunctions`, {
      disableExecuteApiEndpoint: props?.defaultDomainMapping?.domainName === undefined ? false : true
    })
    const httpApiEndpoint = new CfnOutput(scope, `HttpApiEndpointForLambdaFunctions`, {
      value: httpApi.apiEndpoint
    })
    const integrations = lambdaFns.map(lambdaFn => {
      const httpLambdaIntegration = new HttpLambdaIntegration(`HttpLambdaIntegration-${lambdaFn.functionName}`, lambdaFn.functionResource, {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      })
      const httpRoutes = [
        httpApi.addRoutes({
          path: `/${lambdaFn.functionName}`,
          methods: [ HttpMethod.ANY ],
          integration: httpLambdaIntegration,
        }),
        httpApi.addRoutes({
          path: `/${lambdaFn.functionName}/{proxy+}`,
          methods: [ HttpMethod.ANY ],
          integration: httpLambdaIntegration,
        })
      ]
      return {
        httpLambdaIntegration,
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
      target: RecordTarget.fromAlias(new ApiGatewayv2DomainProperties(customDomain.regionalDomainName, customDomain.regionalHostedZoneId))
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
  (b: ReturnType<ReturnType<ReturnType<typeof bucket>>>) =>
  (scope: Construct) => {
    funcs.forEach(func => {
      func.fn.functionResource.addEnvironment('AWS_DYNAMODB_TABLE_NAME', func.t.tableResource.tableName)
      func.fn.functionResource.addEnvironment('AWS_S3_BUCKET_NAME', b.bucketResource.bucketName)
      func.fn.functionResource.addEnvironment('AWS_S3_BUCKET_PREFIX', `${func.fn.functionName}/`)
      func.fn.functionResource.addToRolePolicy(new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'ssm:GetParametersByPath',
          'ssm:GetParameters',
          'ssm:GetParameter'
        ],
        resources: [
          `arn:aws:ssm:::parameter/fx/${func.fn.functionName}/${Names.uniqueId(scope)}/*`
        ]
      }))
    })
    return {}
  }

/**
 * Can be used like `new FunctionStack(new App(), 'function-stack')` directly,
 * but it's better to use the friendlier `stack()` method.
 */
export class FunctionStack extends Stack {
  private called: { functions: boolean, api: boolean } = { functions: false, api: false }
  private fns: Array<ReturnType<ReturnType<typeof func>>> = []
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
  }
  functions (functions: string | Array<ReturnType<typeof func>>, implementation = { bucket, environment }) {
    if (this.called.functions) throw new Error('The `functions()` method should only be called once.')
    this.called.functions = true
    this.fns = Array.isArray(functions) ? functions.map(fn => fn(this)) : globby.sync(functions).map(filename => func(filename)(this))
    const bucket = implementation.bucket(this.fns.map(fn => fn.fn))()(this)
    implementation.environment(this.fns)(bucket)
    return this
  }
  api (options?: Parameters<typeof implementation.domain>[0], zone?: IHostedZone, implementation = { httpApi, domain }) {
    if (!this.called.functions) throw new Error('The `api()` method should only be called after `functions()`.')
    if (this.called.api) throw new Error('The `api()` method should only be called once.')
    this.called.api = true
    const domain = options && zone ? implementation.domain(options)(zone)(this) : undefined
    implementation.httpApi(this.fns.map(fn => fn.fn))(domain?.httpApiProps)(this)
    return this
  }
}

/**
 * The only thing you need.
 * 
 * The only infrastructure you need for all your functions.
 * 
 * All your infrastructure and functions, a single method call away.
 * 
 * Easily spins up a stack of Lambda Functions, each built from a TypeScript file,
 * with a bunch of event sources out of the box.
 * 
 * Each function gets an API route, a queue, and a private path in a shared S3 bucket.
 * Functions in the same stack share the same API and S3 bucket.
 * 
 * It's the fastest way for getting a scalable service up and online.
 * 
 * Example:
 * 
 * ```typescript
 * stack()
 * .functions([
 *   func('src/examples/hello.ts'),
 *   func('src/examples/express.ts')
 * ])
 * .api()
 * ```
 * 
 * You can specify a specific name for your stack with:
 * 
 * ```typescript
 * stack('function-stack').functions([...]).api()
 * ```
 * 
 * Deploy with:
 * npx cdk --app "npx ts-node src/<filename>.ts" deploy
 * 
 * That's it!
 */
export function stack (name: string = process.env.FX_STACK_NAME || 'function-stack', app: App = new App()) {
  return new FunctionStack(app, name)
}
