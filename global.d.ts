export {};

declare global {
  type Nullable<T> = T | null;
  type Recordable<T = any> = Record<string, T>;
  type Numberish = number | string;

  type TargetContext = '_self' | '_blank';

  type ModulesDefaultType = Record<string, { default: Record<string, any> }>;

  interface Fn<T = any, R = T> {
    (...arg: T[]): R;
  }
}
