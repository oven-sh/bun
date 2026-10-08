export interface ProductStatus {
  type:
    // eslint-disable-next-line sonar/max-union-size
    | 'NotDeployed'
    | 'InDeployment'
    | 'Running'
    | 'DeploymentFailure'
    | 'RunningAbnormal'
    | 'Deleting'
    | 'DeleteFailure'
    | 'DeploymentSucceed'
    | 'SystemError'
    | 'Upgrading';
  icon: string;
  text: string;
}
