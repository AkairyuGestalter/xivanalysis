import React from 'react'
import {changelog} from './changelog'
import {Meta} from './Meta'

const DEBUG_IS_APRIL_FIRST: boolean = false && process.env.NODE_ENV !== 'production'
const JS_APRIL_MONTH: number = 3 // JS months start at 0 because reasons

export const CORE = new Meta({
	modules: () => import('./modules' /* webpackChunkName: "core" */),
	Description: getIsAprilFirst()
		? AprilFoolsDescription
		: undefined,
	changelog,

	// Read `docs/patch-checklist.md` before editing the following values.
	supportedPatches: {
		from: '✖',
		to: '✖',
	},
})

export function getIsAprilFirst(): boolean {
	if (DEBUG_IS_APRIL_FIRST) { return true }
	const currentDate: Date = new Date()
	return currentDate.getDate() === 1 && currentDate.getMonth() === JS_APRIL_MONTH
}

function AprilFoolsDescription() {
	return <>
		<div style={{
			display: 'flex',
			alignItems: 'center',
			marginBottom: '10px',
		}}>
			<img
				src={require('../../data/avatar/Clippy.png')}
				style={{width: '60px', marginRight: '1.5em'}}
			/>
			<div>
				You look like you're trying to play FFXIV! Would you like some help?
			</div>
		</div>
	</>
}
