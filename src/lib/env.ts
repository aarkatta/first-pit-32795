import { z } from 'zod';

const localEmulatorHosts = new Set(['127.0.0.1', 'localhost', '::1']);

const localEmulatorHostSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.toLowerCase())
  .refine((value) => localEmulatorHosts.has(value), {
    message: 'must be a loopback host (127.0.0.1, localhost, or ::1)'
  });

const clientEnvSchema = z.object({
  VITE_APP_NAME: z.string().min(1).default('First Pit'),
  VITE_APP_TAGLINE: z.string().min(1).default('Phase 1 foundation'),
  VITE_FIREBASE_API_KEY: z.string().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  VITE_FIREBASE_APP_ID: z.string().min(1),
  VITE_FIREBASE_MEASUREMENT_ID: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),
  VITE_USE_FIREBASE_EMULATORS: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  VITE_FIREBASE_AUTH_EMULATOR_HOST: localEmulatorHostSchema.default('127.0.0.1'),
  VITE_FIREBASE_AUTH_EMULATOR_PORT: z.coerce.number().int().min(1).max(65535).default(9099),
  VITE_FIREBASE_FIRESTORE_EMULATOR_HOST: localEmulatorHostSchema.default('127.0.0.1'),
  VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(8080),
  VITE_FIREBASE_STORAGE_EMULATOR_HOST: localEmulatorHostSchema.default('127.0.0.1'),
  VITE_FIREBASE_STORAGE_EMULATOR_PORT: z.coerce.number().int().min(1).max(65535).default(9199),
  VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST: localEmulatorHostSchema.default('127.0.0.1'),
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: z.coerce.number().int().min(1).max(65535).default(5001)
});

export type ClientEnv = {
  appName: string;
  appTagline: string;
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId?: string;
  };
  useFirebaseEmulators: boolean;
  emulatorHosts: {
    auth: {
      host: string;
      port: number;
    };
    firestore: {
      host: string;
      port: number;
    };
    storage: {
      host: string;
      port: number;
    };
    functions: {
      host: string;
      port: number;
    };
  };
};

export function parseClientEnv(
  rawEnv: Record<string, string | undefined>,
  options: { isProduction?: boolean } = {}
): ClientEnv {
  const isProduction = options.isProduction ?? rawEnv.MODE === 'production';
  // Default the emulator flag by build mode: a dev run that forgets the flag
  // must land on emulators, never silently on the live Firebase project.
  const parsed = clientEnvSchema.safeParse({
    ...rawEnv,
    VITE_USE_FIREBASE_EMULATORS: rawEnv.VITE_USE_FIREBASE_EMULATORS ?? (isProduction ? 'false' : 'true')
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid First Pit client environment:\n${details}`);
  }

  const env = parsed.data;

  if (isProduction && env.VITE_USE_FIREBASE_EMULATORS) {
    throw new Error(
      'Invalid First Pit client environment:\nVITE_USE_FIREBASE_EMULATORS: Firebase emulators cannot be enabled in production'
    );
  }

  return {
    appName: env.VITE_APP_NAME,
    appTagline: env.VITE_APP_TAGLINE,
    firebase: {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
      measurementId: env.VITE_FIREBASE_MEASUREMENT_ID
    },
    useFirebaseEmulators: env.VITE_USE_FIREBASE_EMULATORS,
    emulatorHosts: {
      auth: {
        host: env.VITE_FIREBASE_AUTH_EMULATOR_HOST,
        port: env.VITE_FIREBASE_AUTH_EMULATOR_PORT
      },
      firestore: {
        host: env.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST,
        port: env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT
      },
      storage: {
        host: env.VITE_FIREBASE_STORAGE_EMULATOR_HOST,
        port: env.VITE_FIREBASE_STORAGE_EMULATOR_PORT
      },
      functions: {
        host: env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST,
        port: env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT
      }
    }
  };
}
