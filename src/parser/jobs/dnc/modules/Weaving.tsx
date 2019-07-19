import ACTIONS from 'data/ACTIONS'
import _ from 'lodash'
import CoreWeaving from 'parser/core/modules/Weaving'

const STEP_IDS = [
	ACTIONS.STANDARD_STEP.id,
	ACTIONS.TECHNICAL_STEP.id,
]

export default class Weaving extends CoreWeaving {
	isBadWeave(weave: { leadingGcdEvent: any; trailingGcdEvent: any; gcdTimeDiff: number; weaves: any[]; }) {

		// If the last action in the weave list is a step, remove it then see if it was bad
		// If there's a step in the middle somewhere we'd need to split the list and check their badness individually, which isn't currently supported.
		// That also probably indicates a bad weave in some form since they're spamming oGCDs when they should be dancing.
		if (STEP_IDS.includes(weave.weaves[weave.weaves.length-1].ability.guid)) {
			weave.weaves.pop()
		}

		return super.isBadWeave(weave)
	}
}
