"use client";

/**
 * Form Validation Hook - useZodForm
 *
 * Platform-standard form hook providing:
 * - Type-safe validation with Zod schemas
 * - Consistent validation timing (onBlur for initial, onChange for re-validation)
 * - Automatic error focus management
 * - Accessibility defaults
 *
 * @example
 * ```tsx
 * const schema = z.object({
 *   email: z.string().email("Invalid email"),
 *   password: z.string().min(8, "Too short"),
 * });
 *
 * const form = useZodForm(schema, {
 *   defaultValues: { email: "", password: "" }
 * });
 * ```
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type FieldValues,
  type Resolver,
  useForm,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";

import type { z } from "zod";

/**
 * Zod schemas accepted by useZodForm: object-shaped input and output, as react-hook-form requires.
 */
export type ZodFormSchema = z.ZodType<FieldValues, FieldValues>;

/**
 * Options for useZodForm hook.
 * Extends react-hook-form's UseFormProps with platform defaults.
 *
 * Field values (including `defaultValues`) use the schema's input type; `handleSubmit` receives
 * the parsed output type, so transforms and coercions are reflected in submitted data.
 */
export type UseZodFormOptions<TSchema extends ZodFormSchema> = Omit<
  UseFormProps<z.input<TSchema>, unknown, z.output<TSchema>>,
  "resolver"
>;

/**
 * Platform-standard form hook with Zod validation.
 *
 * Platform defaults:
 * - mode: "onBlur" - Validates when field loses focus (better UX than onChange)
 * - reValidateMode: "onChange" - Re-validates on every change after first validation
 * - shouldFocusError: true - Auto-focuses first error field on submit
 * - criteriaMode: "firstError" - Shows only first error per field (cleaner UI)
 *
 * @param schema - Zod schema for form validation
 * @param options - Additional react-hook-form options (mode, defaultValues, etc.)
 * @returns Typed form instance with all react-hook-form methods
 */
export function useZodForm<TSchema extends ZodFormSchema>(
  schema: TSchema,
  options?: UseZodFormOptions<TSchema>
): UseFormReturn<z.input<TSchema>, unknown, z.output<TSchema>> {
  return useForm<z.input<TSchema>, unknown, z.output<TSchema>>({
    // Platform defaults
    mode: "onBlur", // Validate when field loses focus
    reValidateMode: "onChange", // Re-validate on every change after first validation
    shouldFocusError: true, // Auto-focus first error on submit
    criteriaMode: "firstError", // Show only first error per field
    // User overrides
    ...options,
    // Always use Zod resolver (cannot be overridden). zodResolver cannot match its zod 4 overload
    // against a generic TSchema, so the (correct) input/output resolver type is asserted here.
    resolver: zodResolver(schema) as unknown as Resolver<
      z.input<TSchema>,
      unknown,
      z.output<TSchema>
    >,
  });
}
