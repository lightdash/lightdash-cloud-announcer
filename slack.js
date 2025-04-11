export const getTeamId = (payload) => {
    if (payload.isEnterpriseInstall && payload.enterprise !== undefined) {
        return payload.enterprise.id;
    }
    if (payload.team !== undefined) {
        return payload.team.id;
    }
    if (payload.team_id !== undefined) {
        return payload.team_id;
    }
    else {
        console.error('Payload structure for getTeamId:', JSON.stringify(payload, null, 2));
        throw new Error('Could not find a valid team id in the payload request');
    }
}

export const updateFirstResponderUserGroup = async (client, slackUserId) => {
    try {
        // Get all usergroups
        const userGroupsResponse = await client.usergroups.list();
        
        // Find the first-responder usergroup
        const firstResponderGroup = userGroupsResponse.usergroups.find(
            group => group.name === 'first-responder' || group.handle === 'first-responder'
        );
        
        if (!firstResponderGroup) {
            console.error('First-responder usergroup not found');
            return false;
        }
        
        // Update the usergroup with the new user
        await client.usergroups.users.update({
            usergroup: firstResponderGroup.id,
            users: slackUserId
        });
        
        return true;
    } catch (error) {
        console.error('Error updating first-responder usergroup:', error);
        return false;
    }
}
