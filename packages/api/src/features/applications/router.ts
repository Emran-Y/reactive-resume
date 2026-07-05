import { aiRouter } from "./ai";
import { crudRouter } from "./crud";

export const applicationsRouter = {
	list: crudRouter.list,
	getById: crudRouter.getById,
	create: crudRouter.create,
	import: crudRouter.import,
	update: crudRouter.update,
	addNote: crudRouter.addNote,
	delete: crudRouter.delete,
	bulkUpdate: crudRouter.bulkUpdate,
	bulkDelete: crudRouter.bulkDelete,
	stats: crudRouter.stats,
	tags: crudRouter.tags,
	ai: aiRouter,
};
