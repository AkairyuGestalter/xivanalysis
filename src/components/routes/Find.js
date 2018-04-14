import React, { Component } from 'react'
import { connect } from 'react-redux'
import PropTypes from 'prop-types'

import { fetchReportIfNeeded } from '@/store/actions'

class Find extends Component {
	static propTypes = {
		dispatch: PropTypes.func.isRequired,
		match: PropTypes.shape({
			params: PropTypes.shape({
				code: PropTypes.string.isRequired,
				fight: PropTypes.string
			}).isRequired
		}).isRequired,
		report: PropTypes.shape({

		})
	}

	componentDidMount() {
		const { dispatch, match } = this.props
		dispatch(fetchReportIfNeeded(match.params.code))
	}

	render() {
		const { report } = this.props

		// If report is null, we're probably waiting for an api call to complete
		if (report === null) {
			return <span>Loading...</span>
		}

		// TODO: configurable
		const killsOnly = true

		let fights = report.fights
		if (killsOnly) {
			fights = fights.filter(fight => fight.kill)
		}

		return (
			<div className="container">
				<h1>{report.title}</h1>
				<div className="fights">
					{fights.map(fight => (
						<div key={fight.id} className="fight">
							<div className="bg"></div>
							<div className="title">
								<div className="zone">{fight.zoneName}</div>
								<div className="boss">{fight.name}</div>
							</div>
						</div>
					))}
				</div>
			</div>
		)
	}
}

const mapStateToProps = state => ({
	report: state.report
})

export default connect(mapStateToProps)(Find)
