# Community router

The implementation is `packages/lit-jsx/src/community/router.tsx`. All hooks,
components, and routed elements use its exported module singleton `router`.
An independently constructed `new Router(adapter)` does not rebind them.

## Location and lifecycle

`createHashRouter(routes)` and `createBrowserRouter(routes)` stop, select an
adapter, configure, and start the singleton. `createHistoryRouter` is an alias
of `createBrowserRouter`. Hash mode uses `hashchange`; history mode uses
pathname/search and `popstate`. Serving history URLs requires an app-shell
fallback at those paths.

`router.use(adapter)` resubscribes and resolves the new location when started.
`configure(routes)` also resolves immediately when started. `stop()` detaches
the listener, invalidates pending results, and sets navigation idle; it does
not clear routes or existing match/data, and does not emit a change event.

`LocationAdapter` implements `getPath`, `getSearch`, `createHref`,
`requestUrl`, `listen`, `push`, and `replace`, and exposes `mode`. Search values
exclude the leading `?`. Push/replace return true only when an asynchronous
location event will resolve the change. Hash push returns true for a changed
hash; hash replace uses `replaceState` and returns false. History push and
replace both return false, requiring immediate resolution by the router.

Navigation targets normalize to root-based paths, collapse repeated slashes,
and remove a trailing slash. They are not resolved relative to the current
route. `router.createHref` creates a mode-specific anchor href.

## Matching and rendering

`flatten` compiles nested `RouteConfig[]` into route chains. Configs support
`path`, `index`, `to`, `replace`, `element`, `loader`, `action`, and `children`.
Relative child paths append to the parent; absolute children start at root.
A parent with a path or element also gets its own match. A pathless group can
contribute to a child's chain without rendering its own element.

`matchSegments` supports `:params` and a terminal `*`; params before a splat
are supported. Captured segments are decoded; malformed escapes are retained
as text. Ranking compares specificity by segment: static, parameter, exact
ending, then splat. An index route wins an equal-pattern tie.

Redirects use `to` verbatim as a navigation target without param substitution.
They default to replacement unless `replace: false`. Chains are checked for
cycles before URL changes; a detected cycle yields no match. Non-cyclic
chains execute each redirect with its push/replace behavior.

`router.render()` renders the first config with an element in the matched
chain. Parent elements receive empty props. The final matched config's element
receives `{ params, loaderData, actionData, navigation }`. Only that final
config's loader/action runs; ancestor loaders/actions are not executed.

`<route-view>` renders level zero. `<Outlet />` emits `<route-outlet>` whose
default depth is inferred through parent outlets, including shadow hosts.
`<Outlet depth={1} />` explicitly renders element level two; the callable
function also accepts a numeric depth. Element-less configs consume no render
level. Invalid, negative, or noninteger depths render nothing.

`RoutedElement` renders in light DOM, sets display to block, subscribes while
connected, and requests an update on reconnect. Hooks return current singleton
state; calling a hook alone does not subscribe an arbitrary component.

## Data and forms

A matched leaf loader receives `{ request, params }`. Navigation exposes
`idle`, `loading`, or `submitting`. Loader errors become `{ error: message }`
loader data; action errors become `{ ok: false, message }` action data.

`router.submit(formData, { method })` defaults to POST. GET serializes fields
to a new query for the current path and navigates, without calling an action.
File fields use their file names. Other methods invoke the current leaf
action with `{ request, formData, params }`; HEAD has no Request body. The
action Request and subsequent loader Request retain the submitted location's
query. While the operation remains current, successful or caught action
completion reruns that leaf's loader if one exists.

Navigation, configuration, stop, adapter changes, and new actions invalidate
older work with an operation token. Older promises can complete but cannot
commit their result into the current router state. This does not abort their
underlying operations. `runAction` still returns a completed action result to
its caller after it becomes stale.

`Form` prevents native submission, includes `event.submitter` in FormData,
and either calls its `onSubmit(formData, method)` callback or submits to the
singleton. It does not accept an action target. `Fetcher` also calls the
singleton's `runAction`, affecting the shared navigation/action state and
revalidation. It guards its own data against overlapping submissions and
notifies through its constructor callback; its state spans submitting to idle.

`Link`/`NavLink` intercept unmodified primary clicks. NavLink activity uses
path segments, with root active only at root; `end` requires an exact path.
The search-params setter navigates to the current path with the new query.
`setOutletContext` stores one module-wide value, without per-outlet scoping
or automatic invalidation.
