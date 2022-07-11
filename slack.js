export const getTeamId = (payload) => {
    if (payload.isEnterpriseInstall && payload.enterprise !== undefined) {
        return payload.enterprise.id;
    }
    if (payload.team !== undefined) {
        return payload.team.id;
    }
    else {
        throw new Error('Could not find a valid team id in the payload request');
    }
}
