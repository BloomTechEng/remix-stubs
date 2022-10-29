import React from "react";
import { RemixEntry } from "@remix-run/react/dist/components";
import { createMemoryHistory } from "history";
import {
  unstable_createStaticHandler as createStaticHandler,
  StaticHandler,
  LoaderFunction,
  ActionFunction,
  matchRoutes,
  Location,
} from "@remix-run/router";

import type { AssetsManifest, EntryContext } from "@remix-run/react/dist/entry";
import type { RouteData } from "@remix-run/react/dist/routeData";
import type {
  CatchBoundaryComponent,
  RouteModules,
} from "@remix-run/react/dist/routeModules";
import type { EntryRoute, RouteManifest } from "@remix-run/react/dist/routes";
import type { ShouldReloadFunction } from "@remix-run/react";
import type {
  ErrorBoundaryComponent,
  LinksFunction,
  MetaFunction,
} from "@remix-run/server-runtime";
import type { InitialEntry } from "@remix-run/router";
import type { MemoryHistory, Update } from "history";

/**
 * Base RouteObject with common props shared by all types of mock routes
 */
type BaseMockRouteObject = {
  caseSensitive?: boolean;
  path: string;
  element?: React.ReactNode | null;
  loader?: LoaderFunction;
  action?: ActionFunction;
  links?: LinksFunction;
  meta?: MetaFunction;
  handle?: any;
  CatchBoundary?: CatchBoundaryComponent;
  ErrorBoundary?: ErrorBoundaryComponent;
  unstable_shouldReload?: ShouldReloadFunction;
};

/**
 * Index routes must not have children
 */
export declare type MockIndexRouteObject = BaseMockRouteObject & {
  children?: undefined;
  index: true;
};

/**
 * Non-index routes may have children, but cannot have index
 */
export declare type MockNonIndexRouteObject = BaseMockRouteObject & {
  children?: MockRouteObject[];
  index?: false;
};

/**
 * A route object represents a logical route, with (optionally) its child
 * routes organized in a tree-like structure.
 */
export declare type MockRouteObject =
  | MockIndexRouteObject
  | MockNonIndexRouteObject;

type RemixStubOptions = {
  /**
   *  The initial entries in the history stack. This allows you to start a test with
   *  multiple locations already in the history stack (for testing a back navigation, etc.)
   *  The test will default to the last entry in initialEntries if no initialIndex is provided.
   *  e.g. initialEntries-(["/home", "/about", "/contact"]}
   */
  initialEntries?: InitialEntry[];

  /**
   *  Used to set the route's initial loader data.
   *  e.g. initialLoaderData={("/contact": {locale: "en-US" }}
   */
  initialLoaderData?: RouteData;

  /**
   *  Used to set the route's initial action data.
   *  e.g. initialActionData={("/login": { errors: { email: "invalid email" } }}
   */
  initialActionData?: RouteData;

  /**
   * The initial index in the history stack to render. This allows you to start a test at a specific entry.
   * It defaults to the last entry in initialEntries.
   * e.g.
   *   initialEntries: ["/", "/events/123"]
   *   initialIndex: 1 // start at "/events/123"
   */
  initialIndex?: number;
};

export function createRemixStub(routes: MockRouteObject[]) {
  return function RemixStub({
    initialEntries = ["/"],
    initialLoaderData = {},
    initialActionData,
    initialIndex,
  }: RemixStubOptions) {
    const historyRef = React.useRef<MemoryHistory>();

    if (historyRef.current == null) {
      historyRef.current = createMemoryHistory({
        initialEntries: initialEntries,
        initialIndex: initialIndex,
      });
    }

    let history = historyRef.current;
    let [state, dispatch] = React.useReducer(
      (_: Update, update: Update) => update,
      {
        action: history.action,
        location: history.location,
      }
    );

    React.useLayoutEffect(() => history.listen(dispatch), [history]);

    // Create mock remix context
    const remixContext = createRemixContext(
      routes,
      state.location,
      initialLoaderData,
      initialActionData
    );

    // Setup request handler to handle requests to the mock routes
    let handler = createStaticHandler(routes);

    // Patch fetch so that mock routes can handle action/loader requests
    monkeyPatchFetch(handler);

    return (
      <RemixEntry
        context={remixContext}
        action={state.action}
        location={state.location}
        navigator={history}
      />
    );
  };
}

function createRemixContext(
  routes: MockRouteObject[],
  currentLocation: Location,
  initialLoaderData: RouteData,
  initialActionData?: RouteData
): EntryContext {
  const matches = matchRoutes(routes, currentLocation.pathname);

  return {
    actionData: initialActionData,
    appState: {
      trackBoundaries: true,
      trackCatchBoundaries: true,
      catchBoundaryRouteId: null,
      renderBoundaryRouteId: null,
      loaderBoundaryRouteId: null,
      error: undefined,
      catch: undefined,
    },
    matches: matches as unknown as EntryContext["matches"],
    routeData: initialLoaderData,
    manifest: createManifest(routes),
    routeModules: createRouteModules(routes),
  };
}

function createManifest(routes: MockRouteObject[]): AssetsManifest {
  return {
    routes: routes.reduce((manifest, route) => {
      manifest[route.path] = {
        id: route.path,
        path: route.path,
        hasAction: !!route.action,
        hasLoader: !!route.loader,
        module: "",
        hasCatchBoundary: !!route.CatchBoundary,
        hasErrorBoundary: !!route.ErrorBoundary,
      };
      return manifest;
    }, {} as RouteManifest<EntryRoute>),
    entry: { imports: [], module: "" },
    url: "",
    version: "",
  };
}

function createRouteModules(routes: MockRouteObject[]): RouteModules {
  return routes.reduce((modules, route) => {
    modules[route.path] = {
      CatchBoundary: route.CatchBoundary,
      ErrorBoundary: route.ErrorBoundary,
      default: () => <>{route.element}</>,
      handle: route.handle,
      links: route.links,
      meta: route.meta,
      unstable_shouldReload: route.unstable_shouldReload,
    };
    return modules;
  }, {} as RouteModules);
}

function monkeyPatchFetch(handler: StaticHandler) {
  const originalFetch = window.fetch;
  window.fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {}
  ): Promise<Response> => {
    const request = new Request(input, init);
    try {
      // Send the request to mock routes via @remix-run/router.
      return await handler.queryRoute(request);
    } catch (error) {
      if (error instanceof Response) {
        // 404 or 405 responses passthrough to the original fetch as mock routes couldn't handle the request.
        if (error.status === 404 || error.status === 405) {
          return originalFetch(input, init);
        }
      }
      throw error;
    }
  };
}