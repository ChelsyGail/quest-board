import {ApiError} from './client';
import {JsonApiError} from './types';

export type FieldErrors = Record<string, string>;

export function getFieldErrors(errors: JsonApiError[]): FieldErrors {
  const fieldErrors: FieldErrors = {};
  errors.forEach(error => {
    const field = error.source?.pointer?.split('/').filter(Boolean).pop();
    if (field && error.detail) {
      fieldErrors[field] = error.detail;
    }
  });
  return fieldErrors;
}

export interface DescribedError {
  message: string;
  fieldErrors: FieldErrors;
}

export function describeError(error: unknown): DescribedError {
  if (error instanceof ApiError) {
    const fieldErrors = getFieldErrors(error.errors);
    const hasFieldErrors = Object.keys(fieldErrors).length > 0;
    return {
      message: hasFieldErrors ? 'Please fix the highlighted fields.' : error.message,
      fieldErrors,
    };
  }

  return {message: 'Something went wrong. Please try again.', fieldErrors: {}};
}
