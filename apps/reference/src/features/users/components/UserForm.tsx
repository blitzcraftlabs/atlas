"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  applyServerFieldErrors,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  getFormErrorMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useZodForm,
} from "@atlas/ui";

import { useCreateUser, useUpdateUser, useUser } from "@/features/users";
import {
  type CreateUserFormData,
  createUserFormSchema,
  type UpdateUserFormData,
  updateUserFormSchema,
} from "@/features/users/schemas/user-form";
import { analytics } from "@/lib/analytics";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { hasClientPermission, permissions } from "@/lib/authz";
import { notify } from "@/lib/notifications";

import { ReferenceAuthRequired } from "../../components/ReferenceAuthRequired";
import { ReferenceLoadingState } from "../../components/ReferenceLoadingState";

import type { Control, FieldValues, Path, SubmitHandler, UseFormReturn } from "react-hook-form";

export interface UserFormProps {
  mode: "create" | "edit";
  userId?: string;
}

export function UserForm({ mode, userId }: UserFormProps) {
  if (mode === "create") {
    return <CreateUserForm />;
  }

  if (!userId) {
    return null;
  }

  return <EditUserForm userId={userId} />;
}

function CreateUserForm() {
  const router = useRouter();
  const session = useSession();
  const createUser = useCreateUser();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useZodForm(createUserFormSchema, {
    defaultValues: { email: "", name: "", role: "user" },
  });

  if (session.status === "loading") {
    return <ReferenceLoadingState label="Loading" />;
  }

  if (session.status === "unauthenticated") {
    return <ReferenceAuthRequired />;
  }

  const canSubmit = hasClientPermission(session.permissions, permissions.users.create);

  const onSubmit = async (data: CreateUserFormData) => {
    setServerError(null);

    try {
      await createUser.mutateAsync(data);
      analytics.track("ui.form_submit", { formId: "reference-create-user", success: true });
      analytics.track("feature.used", { feature: "reference-user-create" });
      notify.success("User created");
      router.push("/users");
    } catch (error) {
      analytics.track("ui.form_submit", { formId: "reference-create-user", success: false });

      if (!applyServerFieldErrors(form, error)) {
        const message = getFormErrorMessage(error);
        setServerError(message);
        notify.error(message, {
          description:
            error instanceof ApiError ? `Reference: ${error.shape.correlationId}` : undefined,
        });
      }
    }
  };

  return (
    <UserFormShell
      title="Create user"
      description="Atlas form architecture — Zod validation, server field errors, and mutation pending state."
      cardTitle="New user"
      cardDescription="Set the harness scenario to validation to exercise server field errors."
      canSubmit={canSubmit}
      requiredPermission={permissions.users.create}
      isPending={createUser.isPending}
      submitLabel="Create user"
      cancelHref="/users"
      serverError={serverError}
      form={form}
      onSubmit={onSubmit}
    >
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input type="email" autoComplete="off" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input autoComplete="off" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <RoleField control={form.control} />
    </UserFormShell>
  );
}

function EditUserForm({ userId }: { userId: string }) {
  const router = useRouter();
  const session = useSession();
  const updateUser = useUpdateUser();
  const { data: existingUser, isLoading: userLoading } = useUser(userId);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useZodForm(updateUserFormSchema, {
    defaultValues: { name: "", role: "user" },
  });

  useEffect(() => {
    if (existingUser) {
      form.reset({
        name: existingUser.name,
        role: (existingUser.role ?? "user") as "user" | "admin",
      });
    }
  }, [existingUser, form]);

  if (session.status === "loading" || userLoading) {
    return <ReferenceLoadingState label="Loading" />;
  }

  if (session.status === "unauthenticated") {
    return <ReferenceAuthRequired />;
  }

  const canSubmit = hasClientPermission(session.permissions, permissions.users.update);

  const onSubmit = async (data: UpdateUserFormData) => {
    setServerError(null);

    try {
      await updateUser.mutateAsync({ userId, data });
      analytics.track("ui.form_submit", { formId: "reference-edit-user", success: true });
      notify.success("User updated");
      router.push(`/users/${userId}`);
    } catch (error) {
      analytics.track("ui.form_submit", { formId: "reference-edit-user", success: false });

      if (!applyServerFieldErrors(form, error)) {
        const message = getFormErrorMessage(error);
        setServerError(message);
        notify.error(message, {
          description:
            error instanceof ApiError ? `Reference: ${error.shape.correlationId}` : undefined,
        });
      }
    }
  };

  return (
    <UserFormShell
      title="Edit user"
      description="Update an existing user through the typed API mutation path."
      cardTitle={existingUser?.name ?? "User"}
      cardDescription="Protected admin personas are blocked by resource policy even with users.update."
      canSubmit={canSubmit}
      requiredPermission={permissions.users.update}
      isPending={updateUser.isPending}
      submitLabel="Save changes"
      cancelHref={`/users/${userId}`}
      serverError={serverError}
      form={form}
      onSubmit={onSubmit}
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input autoComplete="off" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <RoleField control={form.control} />
    </UserFormShell>
  );
}

function RoleField<
  TInput extends FieldValues & { role?: "user" | "admin" },
  TOutput extends FieldValues = TInput,
>({ control }: { control: Control<TInput, unknown, TOutput> }) {
  return (
    <FormField
      control={control}
      name={"role" as Path<TInput>}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Role</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function UserFormShell<TInput extends FieldValues, TOutput extends FieldValues = TInput>({
  title,
  description,
  cardTitle,
  cardDescription,
  canSubmit,
  requiredPermission,
  isPending,
  submitLabel,
  cancelHref,
  serverError,
  form,
  onSubmit,
  children,
}: {
  title: string;
  description: string;
  cardTitle: string;
  cardDescription: string;
  canSubmit: boolean;
  requiredPermission: string;
  isPending: boolean;
  submitLabel: string;
  cancelHref: string;
  serverError: string | null;
  /** Field values use the schema input type; submitted data is the parsed output type. */
  form: UseFormReturn<TInput, unknown, TOutput>;
  onSubmit: SubmitHandler<TOutput>;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>

      {!canSubmit ? (
        <Alert variant="destructive">
          <AlertTitle>Permission denied</AlertTitle>
          <AlertDescription>
            Your session does not include <code>{requiredPermission}</code>. Try reference-admin in
            the harness.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{cardTitle}</CardTitle>
          <CardDescription>{cardDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {serverError ? (
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              ) : null}

              {children}

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={!canSubmit || isPending}>
                  {isPending ? "Saving…" : submitLabel}
                </Button>
                <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
                  Cancel
                </Link>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
