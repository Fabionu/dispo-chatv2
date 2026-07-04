import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { listRouter } from './groups/list.js'
import { createRouter } from './groups/create.js'
import { membersRouter } from './groups/members.js'
import { invitesRouter } from './groups/invites.js'
import { updateRouter } from './groups/update.js'
import { avatarRouter } from './groups/avatar.js'
import { messagesRouter } from './groups/messages.js'
import { messageActionsRouter } from './groups/messageActions.js'
import { readStateRouter } from './groups/readState.js'

// The `/api/groups` surface. Historically a single 2,200-line file; it's now
// split by domain into focused sub-routers under ./groups/*, mounted here in
// one place. Every sub-router defines full paths (e.g. `/:id/members`), so
// mounting them all at the router root preserves the exact original URLs.
// requireAuth is applied once, up front, so it still guards every handler.
//
// Route patterns across the sub-routers are mutually exclusive (they differ by
// path shape and/or HTTP method), so the mount order below is behaviour-neutral.
export const groupsRouter = Router()

// All routes require a valid session.
groupsRouter.use(requireAuth)

groupsRouter.use(listRouter) //           GET    /
groupsRouter.use(createRouter) //         POST   /
groupsRouter.use(membersRouter) //        GET/PATCH/DELETE /:id/members[/:userId]
groupsRouter.use(invitesRouter) //        GET/POST /:id/invites
groupsRouter.use(updateRouter) //         PATCH  /:id
groupsRouter.use(avatarRouter) //         GET/POST/DELETE /:id/avatar
groupsRouter.use(messagesRouter) //       GET/POST/PATCH /:id/messages[...]
groupsRouter.use(messageActionsRouter) // POST   /:id/messages/:messageId/{delete,pin,unpin,forward}
groupsRouter.use(readStateRouter) //      POST /:id/read, /:id/unread, PATCH /:id/prefs
