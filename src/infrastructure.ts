import { stack } from './lib/cdk'

stack().functions('src/examples/*.ts').api()
