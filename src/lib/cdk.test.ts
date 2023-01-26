import { stack } from './cdk'

import { Template } from 'aws-cdk-lib/assertions'

test('Only One Private S3 Bucket Created', () => {
  const _stack = stack().functions('src/examples/*.ts').api()
  const template = Template.fromStack(_stack)
  template.resourceCountIs('AWS::S3::Bucket', 1)
  template.hasResourceProperties('AWS::S3::Bucket', {
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true
  })
})
