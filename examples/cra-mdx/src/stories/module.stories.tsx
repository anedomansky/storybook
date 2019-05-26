import React from 'react';
import TypescriptButton from './TypescriptButton';

export const componentMeta: any = {
  title: 'Typescript|Module',
  decorators: [],
  parameters: { component: TypescriptButton },
};

export const small = (): any => <TypescriptButton variant="small" />;
export const large = (): any => <TypescriptButton variant="large" />;
