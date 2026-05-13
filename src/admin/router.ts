import { Hono } from 'hono'
import { homeRoutes } from './home'
import { settingsRoutes } from './settings'
import { vaultRoutes } from './vault'
import { actionsRoutes } from './actions'
import { contactsRoutes } from './contacts'

export const adminRouter = new Hono()

adminRouter.route('/', homeRoutes)
adminRouter.route('/settings', settingsRoutes)
adminRouter.route('/vault', vaultRoutes)
adminRouter.route('/actions', actionsRoutes)
adminRouter.route('/contacts', contactsRoutes)
