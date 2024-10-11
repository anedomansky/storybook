import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import type { Channel } from 'storybook/internal/channels';
import { checkAddonOrder, serverRequire } from 'storybook/internal/common';
import {
  TESTING_MODULE_RUN_ALL_REQUEST,
  TESTING_MODULE_RUN_REQUEST,
  TESTING_MODULE_WATCH_MODE_REQUEST,
} from 'storybook/internal/core-events';
import { oneWayHash, telemetry } from 'storybook/internal/telemetry';
import type { Options, PresetProperty, StoryId } from 'storybook/internal/types';

import { dedent } from 'ts-dedent';

import { STORYBOOK_ADDON_TEST_CHANNEL } from './constants';
import { bootTestRunner } from './node/boot-test-runner';

export const checkActionsLoaded = (configDir: string) => {
  checkAddonOrder({
    before: {
      name: '@storybook/addon-actions',
      inEssentials: true,
    },
    after: {
      name: '@storybook/experimental-addon-test',
      inEssentials: false,
    },
    configFile: isAbsolute(configDir)
      ? join(configDir, 'main')
      : join(process.cwd(), configDir, 'main'),
    getConfig: (configFile) => serverRequire(configFile),
  });
};

type Event = {
  type: 'test-discrepancy';
  payload: {
    storyId: StoryId;
    browserStatus: 'PASS' | 'FAIL';
    cliStatus: 'FAIL' | 'PASS';
    message: string;
  };
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const experimental_serverChannel = async (channel: Channel, options: Options) => {
  const core = await options.presets.apply('core');
  const builderName = typeof core?.builder === 'string' ? core.builder : core?.builder?.name;
  // Only boot the test runner if the builder is vite, else just provide interactions functionality
  if (!builderName?.includes('vite')) {
    return channel;
  }

  let booting = false;
  let booted = false;
  const start =
    (eventName: string) =>
    (...args: any[]) => {
      if (!booted && !booting) {
        booting = true;
        bootTestRunner(channel, eventName, args)
          .then(() => {
            booted = true;
          })
          .catch(() => {
            booted = false;
          })
          .finally(() => {
            booting = false;
          });
      }
    };

  channel.on(TESTING_MODULE_RUN_ALL_REQUEST, start(TESTING_MODULE_RUN_ALL_REQUEST));
  channel.on(TESTING_MODULE_RUN_REQUEST, start(TESTING_MODULE_RUN_REQUEST));
  channel.on(TESTING_MODULE_WATCH_MODE_REQUEST, (payload) => {
    if (payload.watchMode) {
      start(TESTING_MODULE_WATCH_MODE_REQUEST)(payload);
    }
  });

  if (!core.disableTelemetry) {
    const packageJsonPath = require.resolve('@storybook/experimental-addon-test/package.json');

    const { version: addonVersion } = JSON.parse(
      readFileSync(packageJsonPath, { encoding: 'utf-8' })
    );

    channel.on(STORYBOOK_ADDON_TEST_CHANNEL, (event: Event) => {
      // @ts-expect-error This telemetry is not a core one, so we don't have official types for it (similar to onboarding addon)
      telemetry('addon-test', {
        ...event,
        payload: {
          ...event.payload,
          storyId: oneWayHash(event.payload.storyId),
        },
        addonVersion,
      });
    });
  }

  return channel;
};

export const previewAnnotations: PresetProperty<'previewAnnotations'> = async (
  entry = [],
  options
) => {
  checkActionsLoaded(options.configDir);
  return entry;
};

export const managerEntries: PresetProperty<'managerEntries'> = async (entry = [], options) => {
  // Throw an error when addon-interactions is used.
  // This is done by reading an annotation defined in addon-interactions, which although not ideal,
  // is a way to handle addon conflict without having to worry about the order of which they are registered
  const annotation = await options.presets.apply('ADDON_INTERACTIONS_IN_USE', false);
  if (annotation) {
    // eslint-disable-next-line local-rules/no-uncategorized-errors
    const error = new Error(
      dedent`
      You have both addon-interactions and addon-test enabled, which is not allowed.

      addon-test is a replacement for addon-interactions, please uninstall and remove addon-interactions from the addons list in your main config at ${options.configDir}.
      `
    );
    error.name = 'AddonConflictError';

    throw error;
  }

  // for whatever reason seems like the return type of managerEntries is not correct (it expects never instead of string[])
  return entry as never;
};
