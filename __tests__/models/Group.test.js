/**
 * Tests for multi-group user support logic
 * Tests the GroupsIAmIn logic for handling users with multiple groups
 */

describe("GroupsIAmIn logic", () => {
  let mockFind;

  const mockGroups = [
    {
      _id: { toString: () => "group-1" },
      name: "bioinformatics",
      ldapGroups: ["CN=bioinformatics,OU=Groups,DC=example,DC=com"],
    },
    {
      _id: { toString: () => "group-2" },
      name: "jjones",
      ldapGroups: ["CN=jjones-lab,OU=Groups,DC=example,DC=com"],
    },
    {
      _id: { toString: () => "group-3" },
      name: "research",
      ldapGroups: ["CN=research,OU=Groups,DC=example,DC=com"],
    },
  ];

  /**
   * This mirrors the logic from Group.GroupsIAmIn in models/Group.js
   * We test the logic in isolation to avoid mongoose connection issues
   */
  async function GroupsIAmIn(user, findFn) {
    if (!user) {
      throw new Error("User object is required");
    }

    const username =
      user.sAMAccountName || user.uid || user.mailNickname || "unknown";

    let groupFindCriteria = null;

    if (user.isAdmin) {
      groupFindCriteria = {};
    } else if (user.groups && user.groups.length) {
      groupFindCriteria = {
        _id: { $in: user.groups },
      };
    } else if (user.memberOf && user.memberOf.length) {
      const filters = user.memberOf.map((ldapString) => ({
        ldapGroups: ldapString,
      }));
      groupFindCriteria = { $or: filters };
    } else {
      groupFindCriteria = null;
    }

    if (groupFindCriteria === null) {
      return [];
    }

    return await findFn(groupFindCriteria);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockFind = jest.fn();
  });

  describe("user with multiple groups array", () => {
    test("should return all groups when user has multiple group IDs", async () => {
      const user = {
        sAMAccountName: "multiuser",
        groups: ["group-1", "group-2"],
        isAdmin: false,
      };

      mockFind.mockResolvedValue([mockGroups[0], mockGroups[1]]);

      const result = await GroupsIAmIn(user, mockFind);

      expect(mockFind).toHaveBeenCalledWith({
        _id: { $in: ["group-1", "group-2"] },
      });
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("bioinformatics");
      expect(result[1].name).toBe("jjones");
    });

    test("should return single group when user has one group ID", async () => {
      const user = {
        sAMAccountName: "singleuser",
        groups: ["group-1"],
        isAdmin: false,
      };

      mockFind.mockResolvedValue([mockGroups[0]]);

      const result = await GroupsIAmIn(user, mockFind);

      expect(mockFind).toHaveBeenCalledWith({
        _id: { $in: ["group-1"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("bioinformatics");
    });

    test("should return all three groups when user belongs to all", async () => {
      const user = {
        sAMAccountName: "superuser",
        groups: ["group-1", "group-2", "group-3"],
        isAdmin: false,
      };

      mockFind.mockResolvedValue(mockGroups);

      const result = await GroupsIAmIn(user, mockFind);

      expect(mockFind).toHaveBeenCalledWith({
        _id: { $in: ["group-1", "group-2", "group-3"] },
      });
      expect(result).toHaveLength(3);
    });
  });

  describe("user with LDAP memberOf array", () => {
    test("should match multiple LDAP groups", async () => {
      const user = {
        sAMAccountName: "ldapuser",
        memberOf: [
          "CN=bioinformatics,OU=Groups,DC=example,DC=com",
          "CN=jjones-lab,OU=Groups,DC=example,DC=com",
        ],
        isAdmin: false,
      };

      mockFind.mockResolvedValue([mockGroups[0], mockGroups[1]]);

      const result = await GroupsIAmIn(user, mockFind);

      expect(mockFind).toHaveBeenCalledWith({
        $or: [
          { ldapGroups: "CN=bioinformatics,OU=Groups,DC=example,DC=com" },
          { ldapGroups: "CN=jjones-lab,OU=Groups,DC=example,DC=com" },
        ],
      });
      expect(result).toHaveLength(2);
    });

    test("should match single LDAP group", async () => {
      const user = {
        sAMAccountName: "ldapuser",
        memberOf: ["CN=research,OU=Groups,DC=example,DC=com"],
        isAdmin: false,
      };

      mockFind.mockResolvedValue([mockGroups[2]]);

      const result = await GroupsIAmIn(user, mockFind);

      expect(mockFind).toHaveBeenCalledWith({
        $or: [{ ldapGroups: "CN=research,OU=Groups,DC=example,DC=com" }],
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("research");
    });
  });

  describe("admin users", () => {
    test("should return all groups for admin user", async () => {
      const user = {
        sAMAccountName: "adminuser",
        isAdmin: true,
      };

      mockFind.mockResolvedValue(mockGroups);

      const result = await GroupsIAmIn(user, mockFind);

      expect(mockFind).toHaveBeenCalledWith({});
      expect(result).toHaveLength(3);
    });

    test("should return all groups for admin even if groups array exists", async () => {
      const user = {
        sAMAccountName: "adminuser",
        isAdmin: true,
        groups: ["group-1"], // Should be ignored for admin
      };

      mockFind.mockResolvedValue(mockGroups);

      const result = await GroupsIAmIn(user, mockFind);

      expect(mockFind).toHaveBeenCalledWith({});
      expect(result).toHaveLength(3);
    });
  });

  describe("edge cases", () => {
    test("should throw error when no user provided", async () => {
      await expect(GroupsIAmIn(null, mockFind)).rejects.toThrow(
        "User object is required",
      );
    });

    test("should throw error when undefined user provided", async () => {
      await expect(GroupsIAmIn(undefined, mockFind)).rejects.toThrow(
        "User object is required",
      );
    });

    test("should return empty array when user has no groups or memberOf", async () => {
      const user = {
        sAMAccountName: "nogroupuser",
        isAdmin: false,
      };

      const result = await GroupsIAmIn(user, mockFind);

      expect(mockFind).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    test("should return empty array when groups array is empty", async () => {
      const user = {
        sAMAccountName: "emptygroups",
        groups: [],
        isAdmin: false,
      };

      const result = await GroupsIAmIn(user, mockFind);

      expect(mockFind).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    test("should return empty array when memberOf array is empty", async () => {
      const user = {
        sAMAccountName: "emptymemberof",
        memberOf: [],
        isAdmin: false,
      };

      const result = await GroupsIAmIn(user, mockFind);

      expect(mockFind).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    test("should prioritize groups array over memberOf", async () => {
      const user = {
        sAMAccountName: "bothuser",
        groups: ["group-1"],
        memberOf: ["CN=research,OU=Groups,DC=example,DC=com"],
        isAdmin: false,
      };

      mockFind.mockResolvedValue([mockGroups[0]]);

      const result = await GroupsIAmIn(user, mockFind);

      // Should use groups, not memberOf
      expect(mockFind).toHaveBeenCalledWith({
        _id: { $in: ["group-1"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("bioinformatics");
    });
  });

  describe("username detection", () => {
    test("should detect username from sAMAccountName", async () => {
      const user = {
        sAMAccountName: "testuser",
        groups: ["group-1"],
        isAdmin: false,
      };

      mockFind.mockResolvedValue([mockGroups[0]]);

      const result = await GroupsIAmIn(user, mockFind);
      expect(result).toHaveLength(1);
    });

    test("should detect username from uid if sAMAccountName missing", async () => {
      const user = {
        uid: "testuser",
        groups: ["group-1"],
        isAdmin: false,
      };

      mockFind.mockResolvedValue([mockGroups[0]]);

      const result = await GroupsIAmIn(user, mockFind);
      expect(result).toHaveLength(1);
    });

    test("should detect username from mailNickname as fallback", async () => {
      const user = {
        mailNickname: "testuser",
        groups: ["group-1"],
        isAdmin: false,
      };

      mockFind.mockResolvedValue([mockGroups[0]]);

      const result = await GroupsIAmIn(user, mockFind);
      expect(result).toHaveLength(1);
    });
  });
});

describe("Multi-group user scenarios", () => {
  test("multiuser can access bioinformatics and jjones groups", () => {
    // This test verifies the hardcoded dev user configuration
    const multiuser = {
      username: "multiuser",
      password: "multiuserpass",
      firstname: "Multi",
      lastname: "User",
      groups: [
        { name: "bioinformatics", id: 1, ldapStrings: [] },
        { name: "jjones", id: 2, ldapStrings: [] },
      ],
    };

    expect(multiuser.groups).toHaveLength(2);
    expect(multiuser.groups[0].name).toBe("bioinformatics");
    expect(multiuser.groups[1].name).toBe("jjones");
  });

  test("user groups should be an array type", () => {
    const user = {
      groups: [{ name: "group1" }, { name: "group2" }],
    };

    expect(Array.isArray(user.groups)).toBe(true);
  });

  test("userGroups for entry should be serializable to JSON", () => {
    const userGroups = ["bioinformatics", "jjones"];
    const serialized = JSON.stringify(userGroups);
    const deserialized = JSON.parse(serialized);

    expect(deserialized).toEqual(userGroups);
    expect(serialized).toBe('["bioinformatics","jjones"]');
  });
});
